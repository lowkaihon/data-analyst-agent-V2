"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import React, { createContext, useContext, useState, useMemo, type ComponentProps, type ReactNode } from "react";
import { CodeBlock } from "./code-block";

// Context to track if tool is open (for lazy rendering)
const ToolOpenContext = createContext<boolean>(false);

export type ToolProps = ComponentProps<typeof Collapsible> & {
  lazyRender?: boolean; // Default true for performance
};

export const Tool = React.memo(({ className, defaultOpen = false, lazyRender = true, onOpenChange, ...props }: ToolProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };

  return (
    <ToolOpenContext.Provider value={lazyRender ? isOpen : true}>
      <Collapsible
        className={cn("not-prose mb-4 w-full rounded-md border", className)}
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </ToolOpenContext.Provider>
  );
});

export type ToolHeaderProps = {
  type: ToolUIPart["type"];
  state: ToolUIPart["state"];
  className?: string;
};

const getStatusBadge = (status: ToolUIPart["state"]) => {
  const labels: Record<ToolUIPart["state"], string> = {
    "input-streaming": "Pending",
    "input-available": "Running",
    "approval-requested": "Approval Required",
    "approval-responded": "Approved",
    "output-available": "Completed",
    "output-error": "Error",
    "output-denied": "Denied",
  };

  const icons: Record<ToolUIPart["state"], React.ReactNode> = {
    "input-streaming": <CircleIcon className="size-4" />,
    "input-available": <ClockIcon className="size-4 animate-pulse" />,
    "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
    "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
    "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
    "output-error": <XCircleIcon className="size-4 text-red-600" />,
    "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  };

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {icons[status]}
      {labels[status]}
    </Badge>
  );
};

export const ToolHeader = React.memo(({
  className,
  type,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center justify-between gap-4 p-3",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">{type}</span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
));

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = React.memo(({ className, children, ...props }: ToolContentProps) => {
  const isOpen = useContext(ToolOpenContext);

  return (
    <CollapsibleContent
      className={cn(
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      {/* Only render children when open to avoid expensive operations on collapsed tools */}
      {isOpen ? children : null}
    </CollapsibleContent>
  );
});

export type ToolInputProps = ComponentProps<"div"> & {
  input: any;
};

export const ToolInput = React.memo(({ className, input, ...props }: ToolInputProps) => {
  // Memoize JSON.stringify to avoid recomputing on every render
  const stringifiedInput = useMemo(() => JSON.stringify(input, null, 2), [input]);

  return (
    <div className={cn("space-y-2 overflow-hidden p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Parameters
      </h4>
      <div className="rounded-md bg-muted/50">
        <CodeBlock code={stringifiedInput} language="json" />
      </div>
    </div>
  );
});

export type ToolOutputProps = ComponentProps<"div"> & {
  output: any;
  errorText?: string;
};

export const ToolOutput = React.memo(({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  // Memoize JSON.stringify to avoid recomputing on every render
  const Output = useMemo(() => {
    if (!(output || errorText)) {
      return null;
    }

    if (typeof output === "object") {
      return (
        <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
      );
    } else if (typeof output === "string") {
      return <CodeBlock code={output} language="json" />;
    }

    return <div>{output as ReactNode}</div>;
  }, [output, errorText]);

  if (!(output || errorText)) {
    return null;
  }

  return (
    <div className={cn("space-y-2 p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
});
