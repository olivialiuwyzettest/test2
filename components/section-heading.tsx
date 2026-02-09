import { cn } from "@/lib/ui/cn";

export function SectionHeading(props: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-4", props.className)}>
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {props.title}
        </h2>
        {props.subtitle ? (
          <p className="mt-1 text-xs text-muted-foreground">{props.subtitle}</p>
        ) : null}
      </div>
      {props.right ? <div className="shrink-0">{props.right}</div> : null}
    </div>
  );
}

