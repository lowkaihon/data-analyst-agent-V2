import { type NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres"
import { sanitizeTableName } from "@/lib/sql-guard"
import { parse } from "csv-parse/sync"
import { checkRateLimit } from "@/lib/rate-limit"

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const MAX_COLUMNS = 30

// Sanitize column names to prevent SQL injection
function sanitizeColumnName(name: string): string {
  // Replace special characters with underscore
  // Only allow alphanumeric, underscore, and space
  let sanitized = name.replace(/[^a-zA-Z0-9_ ]/g, "_")

  // Trim and limit length to PostgreSQL column name limit (63 chars)
  sanitized = sanitized.trim().substring(0, 63)

  // If name becomes empty after sanitization, use a default
  if (sanitized.length === 0) {
    sanitized = "column"
  }

  return sanitized
}

// Sanitize CSV cell values to prevent formula injection
function sanitizeCSVValue(value: any): any {
  // Only sanitize string values
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trimStart()

  // Block obvious formula prefixes (OWASP CSV injection guidelines)
  if (trimmed.startsWith('=') ||
      trimmed.startsWith('+') ||
      trimmed.startsWith('@') ||
      trimmed.startsWith('|') ||
      trimmed.startsWith('\t') ||
      trimmed.startsWith('\r')) {
    // Prefix with single quote to neutralize formula
    return "'" + value
  }

  // Smart handling for minus sign: distinguish negative numbers from formulas
  if (trimmed.startsWith('-')) {
    const afterMinus = trimmed.substring(1).trimStart()

    // If followed by digit or decimal point, it's a legitimate negative number
    // Examples: -1, -5.5, -0.123
    if (/^[\d.]/.test(afterMinus)) {
      return value  // Allow negative numbers
    }

    // Otherwise, treat as potential formula injection
    // Examples: -@SUM(), -command, -=formula
    return "'" + value
  }

  return value
}

// Parse CSV with consistent options, varying only the delimiter
function tryParseCSV(content: string, delimiter: string) {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter,
    relax_quotes: true,
    relax_column_count: true,
    escape: "\\",
    quote: '"',
  })
}

// Clean up temporary storage file (best-effort, never throws)
async function cleanupStorageFile(storagePath: string): Promise<void> {
  try {
    const adminClient = await createAdminClient()
    const { error: deleteError } = await adminClient.storage.from("csv-uploads").remove([storagePath])
    if (deleteError) {
      console.error("Failed to delete storage file:", deleteError)
    } else {
      console.log("Deleted temporary storage file:", storagePath)
    }
  } catch (cleanupError) {
    console.error("Storage cleanup error:", cleanupError)
  }
}

export async function POST(req: NextRequest) {
  // Declare storagePath outside try block so it's accessible in catch for cleanup
  let storagePath: string | null = null

  try {
    // Check if this is a storage upload (JSON body) or direct upload (FormData)
    const contentType = req.headers.get("content-type") || ""
    const isStorageUpload = contentType.includes("application/json")

    let file: File | null = null
    let context: string | null = null
    let fileName: string = ""

    if (isStorageUpload) {
      // Storage upload: Download file from Supabase Storage
      const body = await req.json()
      storagePath = body.storagePath
      context = body.context || null
      fileName = body.fileName || "upload.csv"

      if (!storagePath || typeof storagePath !== "string") {
        return NextResponse.json({ error: "storagePath is required for storage uploads" }, { status: 400 })
      }

      // Download file from storage using admin client (bypasses RLS)
      const adminClient = await createAdminClient()
      const { data: fileData, error: downloadError } = await adminClient.storage
        .from("csv-uploads")
        .download(storagePath)

      if (downloadError || !fileData) {
        console.error("Storage download error:", downloadError)
        return NextResponse.json(
          {
            error: "Failed to download file from storage",
            details: downloadError?.message || "File not found",
          },
          { status: 500 },
        )
      }

      // Convert Blob to File object
      file = new File([fileData], fileName, { type: "text/csv" })
    } else {
      // Direct upload: Parse form data
      let formData: FormData
      try {
        formData = await req.formData()
      } catch (formError) {
        console.error("Form data parsing error:", formError)
        return NextResponse.json(
          {
            error: "Failed to parse request body",
            details: formError instanceof Error ? formError.message : "Invalid request format",
          },
          { status: 400 },
        )
      }

      file = formData.get("file") as File
      context = formData.get("context") as string
      fileName = file?.name || "upload.csv"
    }

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file type (MIME type)
    if (file.type !== "text/csv" && file.type !== "text/plain" && file.type !== "") {
      return NextResponse.json(
        { error: "Invalid file type. Only CSV files are allowed." },
        { status: 400 },
      )
    }

    // Validate file extension
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json(
        { error: "Invalid file extension. Only .csv files are allowed." },
        { status: 400 },
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File size must be less than 20MB" }, { status: 400 })
    }

    // Validate file is not empty
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 })
    }

    // Read and parse CSV
    const fileContent = await file.text()

    let records: any[] = []
    let parseError: Error | null = null

    // Try delimiters in order: comma (most common), semicolon (European), tab
    const delimiters = [",", ";", "\t"]
    for (const delimiter of delimiters) {
      try {
        records = tryParseCSV(fileContent, delimiter)
        parseError = null
        break
      } catch (err) {
        // Keep the first error (comma) as it's the most common format
        if (!parseError) parseError = err as Error
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

    // Sanitize column names early to prevent SQL injection
    const originalColumns = Object.keys(records[0])
    if (originalColumns.length > MAX_COLUMNS) {
      return NextResponse.json(
        { error: `Too many columns. Maximum ${MAX_COLUMNS} columns allowed, found ${originalColumns.length}` },
        { status: 400 },
      )
    }

    // Remap records with sanitized column names
    const sanitizedRecords = records.map((record) => {
      const sanitizedRecord: any = {}
      for (const col of originalColumns) {
        const sanitizedCol = sanitizeColumnName(col)
        sanitizedRecord[sanitizedCol] = record[col]
      }
      return sanitizedRecord
    })

    const columns = Object.keys(sanitizedRecords[0])

    const supabase = await createClient()

    // Get the authenticated user (including anonymous users)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // Rate limiting: 5 uploads per hour per user
    const rateLimit = await checkRateLimit('/api/ingest', 5, 60 * 60 * 1000)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. Maximum 5 uploads per hour allowed. Try again after ${rateLimit.resetAt.toLocaleTimeString()}.`,
          resetAt: rateLimit.resetAt.toISOString(),
          limit: rateLimit.limit,
          remaining: rateLimit.remaining
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimit.limit.toString(),
            'X-RateLimit-Remaining': rateLimit.remaining.toString(),
            'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
            'Retry-After': Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000).toString()
          }
        }
      )
    }

    // Storage quota: max 10 datasets per user
    const { count: datasetCount, error: countError } = await supabase
      .from("datasets")
      .select("id", { count: 'exact', head: true })
      .eq("user_id", user.id)

    if (countError) {
      console.error("Error counting datasets:", countError)
      return NextResponse.json({ error: "Failed to check storage quota" }, { status: 500 })
    }

    const MAX_DATASETS_PER_USER = 10
    if (datasetCount !== null && datasetCount >= MAX_DATASETS_PER_USER) {
      return NextResponse.json(
        {
          error: `Storage quota exceeded. Maximum ${MAX_DATASETS_PER_USER} datasets allowed. Please delete old datasets before uploading new ones.`,
          current: datasetCount,
          limit: MAX_DATASETS_PER_USER
        },
        { status: 403 }
      )
    }

    // Generate table name first (before creating the dataset)
    const tempId = crypto.randomUUID()
    const tableName = sanitizeTableName(tempId)

    // Create dataset record with user_id
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .insert({
        id: tempId,
        file_name: file.name,
        user_context: context || null,
        table_name: tableName,
        row_count: sanitizedRecords.length,
        column_count: columns.length,
        user_id: user.id,
      })
      .select()
      .single()

    if (datasetError) {
      console.error("Dataset creation error:", datasetError)

      // Check for schema-related errors (missing columns, RLS issues)
      const errorMessage = datasetError.message || ""
      if (errorMessage.includes("column") && errorMessage.includes("does not exist")) {
        return NextResponse.json(
          {
            error: "Database schema mismatch. Please run database migration scripts.",
            details: "The database schema is outdated. Run scripts/reset_database.sql followed by scripts/initialize_database.sql",
            technicalError: errorMessage,
          },
          { status: 500 },
        )
      }

      if (errorMessage.includes("permission denied") || errorMessage.includes("policy")) {
        return NextResponse.json(
          {
            error: "Database permission error. Please check RLS policies.",
            details: "Row Level Security policies may not be configured correctly.",
            technicalError: errorMessage,
          },
          { status: 500 },
        )
      }

      return NextResponse.json(
        {
          error: "Failed to create dataset",
          details: errorMessage || "Unknown database error",
        },
        { status: 500 },
      )
    }

    // Infer column types from first 500 rows (using sanitized records)
    const sampleSize = Math.min(500, sanitizedRecords.length)
    const columnTypes = inferColumnTypes(sanitizedRecords.slice(0, sampleSize))

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
        const columnNames = Object.keys(sanitizedRecords[0])

        // Calculate safe batch size to avoid PostgreSQL parameter limit (65535)
        // Formula: batch_size = floor(60000 / column_count) for safety margin
        const dynamicBatchSize = Math.max(1, Math.floor(60000 / columnNames.length))
        const batchSize = Math.min(dynamicBatchSize, 1000) // Cap at 1000 for reasonable query size

        console.log(
          `Inserting ${sanitizedRecords.length} rows in batches of ${batchSize} (${columnNames.length} columns)`,
        )

        // Insert in batches
        for (let i = 0; i < sanitizedRecords.length; i += batchSize) {
          const batch = sanitizedRecords.slice(i, i + batchSize)

          // Build parameterized INSERT query
          const placeholders = batch
            .map((_, rowIdx) => {
              const rowPlaceholders = columnNames.map((_, colIdx) => `$${rowIdx * columnNames.length + colIdx + 1}`)
              return `(${rowPlaceholders.join(", ")})`
            })
            .join(", ")

          const insertSQL = `INSERT INTO ${tableName} (${columnNames.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders}`
          const values = batch.flatMap((row) => columnNames.map((col) => sanitizeCSVValue(row[col])))

          await client.query(insertSQL, values)

          const batchNumber = Math.floor(i / batchSize) + 1
          const totalBatches = Math.ceil(sanitizedRecords.length / batchSize)
          console.log(`Inserted batch ${batchNumber}/${totalBatches} (${batch.length} rows)`)
        }

        console.log(`Successfully inserted all ${sanitizedRecords.length} rows`)

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

    // Cleanup: Delete temporary file from storage (if it was a storage upload)
    if (storagePath) {
      await cleanupStorageFile(storagePath)
    }

    return NextResponse.json({
      datasetId: dataset.id,
      fileName: fileName,
      rowCount: sanitizedRecords.length,
      columnCount: columns.length,
    })
  } catch (error) {
    console.error("Ingest error:", error)

    // Cleanup: Delete temporary file from storage (if it was a storage upload)
    if (storagePath) {
      await cleanupStorageFile(storagePath)
    }

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
