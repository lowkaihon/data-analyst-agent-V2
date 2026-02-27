import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDown, ChevronUp } from "lucide-react"

interface RunResultsTableProps {
  columns: string[]
  sample: any[]
  rowCountLabel: string
  expanded: boolean
  onToggle: () => void
  label?: string
}

export function RunResultsTable({ columns, sample, rowCountLabel, expanded, onToggle, label = "Results" }: RunResultsTableProps) {
  return (
    <Collapsible open={expanded} onOpenChange={onToggle} className="mt-3">
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          {expanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
          {expanded ? "Hide" : "View"} {label} ({rowCountLabel})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sample.map((row: any, rowIndex: number) => (
                <TableRow key={rowIndex}>
                  {columns.map((column) => {
                    const value = row[column]
                    return (
                      <TableCell key={column}>
                        {value === null || value === undefined
                          ? <span className="text-muted-foreground italic">null</span>
                          : typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value)}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
