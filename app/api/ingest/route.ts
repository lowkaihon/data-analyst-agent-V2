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
      console.error("[v0] CSV parse error:", parseError)
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

    // Create dataset record
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .insert({
        file_name: file.name,
        context_note: context || null,
        row_count: records.length,
      })
      .select()
      .single()

    if (datasetError) {
      console.error("[v0] Dataset creation error:", datasetError)
      return NextResponse.json({ error: "Failed to create dataset" }, { status: 500 })
    }

    // Infer column types from first 100 rows
    const sampleSize = Math.min(100, records.length)
    const columnTypes = inferColumnTypes(records.slice(0, sampleSize))

    const pool = getPostgresPool()
    const tableName = sanitizeTableName(dataset.id)
    const createTableSQL = generateCreateTableSQL(tableName, columnTypes)

    try {
      await pool.query(createTableSQL)
      console.log("[v0] Table created successfully:", tableName)
    } catch (createError) {
      console.error("[v0] Table creation error:", createError)
      return NextResponse.json({ error: "Failed to create data table" }, { status: 500 })
    }

    // Insert data in batches using direct Postgres connection
    const batchSize = 1000
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)

      try {
        // Build parameterized INSERT query
        const columnNames = Object.keys(batch[0])
        const placeholders = batch
          .map((_, rowIdx) => {
            const rowPlaceholders = columnNames.map((_, colIdx) => `$${rowIdx * columnNames.length + colIdx + 1}`)
            return `(${rowPlaceholders.join(", ")})`
          })
          .join(", ")

        const insertSQL = `INSERT INTO ${tableName} (${columnNames.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders}`
        const values = batch.flatMap((row) => columnNames.map((col) => row[col]))

        await pool.query(insertSQL, values)
        console.log(`[v0] Inserted batch ${i / batchSize + 1} (${batch.length} rows)`)
      } catch (insertError) {
        console.error("[v0] Batch insert error:", insertError)
        return NextResponse.json({ error: "Failed to insert data" }, { status: 500 })
      }
    }

    return NextResponse.json({
      datasetId: dataset.id,
      fileName: file.name,
      rowCount: records.length,
      columnCount: columns.length,
    })
  } catch (error) {
    console.error("[v0] Ingest error:", error)
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
