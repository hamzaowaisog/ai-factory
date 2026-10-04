// @client
import { OTPInput, type SlotProps } from "input-otp";
import { cn } from "@/lib/utils";

function Slot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div className={cn("relative flex size-10 items-center justify-center border-y border-e border-input bg-card text-base first:rounded-s-md first:border-s last:rounded-e-md", isActive && "z-10 ring-2 ring-ring")}>
      {char}
      {hasFakeCaret && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="h-4 w-px animate-pulse bg-foreground" /></div>}
    </div>
  );
}

/** A one-time code, one box per digit. */
export function OtpField({ length = 6, value, onChange, disabled, labelledBy }: { length?: number; value?: string; onChange?: (v: string) => void; disabled?: boolean; labelledBy?: string }) {
  return (
    <OTPInput
      maxLength={length}
      value={value ?? ""}
      onChange={(v) => onChange?.(v)}
      disabled={disabled}
      aria-labelledby={labelledBy}
      containerClassName="flex items-center"
      render={({ slots }) => <div className="flex">{slots.map((s, i) => <Slot key={i} {...s} />)}</div>}
    />
  );
}
