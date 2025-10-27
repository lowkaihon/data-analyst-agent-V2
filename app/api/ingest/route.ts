import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres"
import { sanitizeTableName } from "@/lib/sql-guard"
import { parse } from "csv-parse/sync"

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const MAX_COLUMNS = 200

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File
    const context = formData.get("context") as string

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File size must be less than 20MB" }, { status: 400 })
    }

    // Read and parse CSV
    const fileContent = await file.text()

    let records: any[] = []
    let parseError: Error | null = null

    // Try comma first (most common)
    try {
      records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: ",",
        relax_quotes: true,
        relax_column_count: true,
        escape: "\\",
        quote: '"',
      })
    } catch (commaError) {
      // Try semicolon (common in European locales)
      try {
        records = parse(fileContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          delimiter: ";",
          relax_quotes: true,
          relax_column_count: true,
          escape: "\\",
          quote: '"',
        })
      } catch (semicolonError) {
        // Try tab-delimited
        try {
          records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            delimiter: "\t",
            relax_quotes: true,
            relax_column_count: true,
            escape: "\\",
            quote: '"',
          })
        } catch (tabError) {
          parseError = commaError as Error
        }
      }
    }

    if (parseError || records.length === 0) {
      console.error("CSV parse error:", parseError)
      return NextResponse.json(
        {
          error: "Failed to parse CSV file. Please ensure it's a valid CSV with comma, semicolon, or tab delimiters.",
        },
        { status: 400 },
      )
    }

    // Validate column count
    const columns = Object.keys(records[0])
    if (columns.length > MAX_COLUMNS) {
      return NextResponse.json(
        { error: `Too many columns. Maximum ${MAX_COLUMNS} columns allowed, found ${columns.length}` },
        { status: 400 },
      )
    }

    const supabase = await createClient()

    // Generate table name first (before creating the dataset)
    const tempId = crypto.randomUUID()
    const tableName = sanitizeTableName(tempId)

    // Create dataset record
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .insert({
        id: tempId,
        file_name: file.name,
        user_context: context || null,
        table_name: tableName,
        row_count: records.length,
        column_count: columns.length,
      })
      .select()
      .single()

    if (datasetError) {
      console.error("Dataset creation error:", datasetError)
      return NextResponse.json({ error: "Failed to create dataset" }, { status: 500 })
    }

    // Infer column types from first 100 rows
    const sampleSize = Math.min(100, records.length)
    const columnTypes = inferColumnTypes(records.slice(0, sampleSize))

    const pool = getPostgresPool()
    const createTableSQL = generateCreateTableSQL(tableName, columnTypes)

    // Use a single database client for transaction support
    const client = await pool.connect()

    try {
      // Create table
      await client.query(createTableSQL)
      console.log("Table created successfully:", tableName)

      // Start transaction for atomic inserts
      await client.query("BEGIN")

      try {
        // Insert data using optimized batch inserts with dynamic sizing
        const columnNames = Object.keys(records[0])

        // Calculate safe batch size to avoid PostgreSQL parameter limit (65535)
        // Formula: batch_size = floor(60000 / column_count) for safety margin
        const dynamicBatchSize = Math.max(1, Math.floor(60000 / columnNames.length))
        const batchSize = Math.min(dynamicBatchSize, 1000) // Cap at 1000 for reasonable query size

        console.log(
          `Inserting ${records.length} rows in batches of ${batchSize} (${columnNames.length} columns)`,
        )

        // Insert in batches
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize)

          // Build parameterized INSERT query
          const placeholders = batch
            .map((_, rowIdx) => {
              const rowPlaceholders = columnNames.map((_, colIdx) => `$${rowIdx * columnNames.length + colIdx + 1}`)
              return `(${rowPlaceholders.join(", ")})`
            })
            .join(", ")

          const insertSQL = `INSERT INTO ${tableName} (${columnNames.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders}`
          const values = batch.flatMap((row) => columnNames.map((col) => row[col]))

          await client.query(insertSQL, values)

          const batchNumber = Math.floor(i / batchSize) + 1
          const totalBatches = Math.ceil(records.length / batchSize)
          console.log(`Inserted batch ${batchNumber}/${totalBatches} (${batch.length} rows)`)
        }

        console.log(`Successfully inserted all ${records.length} rows`)

        // Commit transaction
        await client.query("COMMIT")
        console.log("Transaction committed successfully")
      } catch (insertError) {
        // Rollback on any insert error
        await client.query("ROLLBACK")
        console.error("Insert error, rolled back transaction:", insertError)

        // Cleanup: delete dataset record since data insertion failed
        await supabase.from("datasets").delete().eq("id", dataset.id)

        return NextResponse.json(
          {
            error: "Failed to insert data into table",
            details: insertError instanceof Error ? insertError.message : "Unknown error",
          },
          { status: 500 },
        )
      }
    } catch (tableError) {
      console.error("Table creation error:", tableError)

      // Cleanup: delete dataset record since table creation failed
      await supabase.from("datasets").delete().eq("id", dataset.id)

      return NextResponse.json(
        {
          error: "Failed to create data table",
          details: tableError instanceof Error ? tableError.message : "Unknown error",
        },
        { status: 500 },
      )
    } finally {
      // Always release the client back to the pool
      client.release()
    }

    return NextResponse.json({
      datasetId: dataset.id,
      fileName: file.name,
      rowCount: records.length,
      columnCount: columns.length,
    })
  } catch (error) {
    console.error("Ingest error:", error)
    return NextResponse.json({ error: "Failed to process file" }, { status: 500 })
  }
}

function inferColumnTypes(records: any[]): Record<string, string> {
  if (records.length === 0) return {}

  const columns = Object.keys(records[0])
  const types: Record<string, string> = {}

  for (const col of columns) {
    let isInteger = true
    let isFloat = true
    let isBoolean = true
    let isDate = true

    for (const record of records) {
      const value = record[col]

      if (value === null || value === undefined || value === "") continue

      // Check integer
      if (isInteger && !/^-?\d+$/.test(String(value))) {
        isInteger = false
      }

      // Check float
      if (isFloat && !/^-?\d*\.?\d+$/.test(String(value))) {
        isFloat = false
      }

      // Check boolean
      if (isBoolean && !["true", "false", "0", "1", "yes", "no"].includes(String(value).toLowerCase())) {
        isBoolean = false
      }

      // Check date
      if (isDate && isNaN(Date.parse(String(value)))) {
        isDate = false
      }
    }

    if (isInteger) {
      types[col] = "INTEGER"
    } else if (isFloat) {
      types[col] = "DOUBLE PRECISION"
    } else if (isBoolean) {
      types[col] = "BOOLEAN"
    } else if (isDate) {
      types[col] = "TIMESTAMPTZ"
    } else {
      types[col] = "TEXT"
    }
  }

  return types
}

function generateCreateTableSQL(tableName: string, columnTypes: Record<string, string>): string {
  const columns = Object.entries(columnTypes)
    .map(([name, type]) => `"${name}" ${type}`)
    .join(", ")

  return `CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL PRIMARY KEY, ${columns})`
}
