// @client
import { FileText, Upload, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, UploadData } from "./types";

export function UploadBlock({ label, hint, files = [], mark, onAction, className }: UploadData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("grid gap-3 p-pad", className)}>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center hover:bg-muted/50">
        <Upload className="size-6 text-muted-foreground" />
        <span className="font-medium">{t(label)}</span>
        {hint && <span className="text-xs text-muted-foreground">{t(hint)}</span>}
        <input type="file" className="sr-only" multiple onChange={(e) => onAction?.(label, e.currentTarget)} />
      </label>
      {files.map((f) => (
        <div key={f.name} className="flex items-center gap-3 text-sm">
          <FileText className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate">{f.name} <span className="text-muted-foreground">{f.size}</span></p>
            {f.status === "uploading" && <Progress value={f.progress ?? 0} aria-label={f.name} className="mt-1 h-1.5" />}
            {f.status === "failed" && <p className="text-xs text-destructive">{t("Upload failed")}</p>}
          </div>
          <button type="button" aria-label={`${t("Remove")} ${f.name}`} className="rounded-sm p-1 hover:bg-muted" onClick={(e) => onAction?.("Remove", e.currentTarget)}><X className="size-4" /></button>
        </div>
      ))}
    </Card>
  );
}
