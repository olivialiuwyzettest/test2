import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/ui/cn";

export function KpiCard(props: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <Card className={cn("animate-fade-up", props.className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground">{props.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-3xl font-semibold tracking-tight", props.valueClassName)}>
          {props.value}
        </div>
        {props.sub ? (
          <div className="mt-1 text-xs text-muted-foreground">{props.sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

