// @client
// One form field, drawn with the control its kind calls for (src/contracts/artifacts.ts, FormField).
import { Eye, EyeOff, Info } from "lucide-react";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { OtpField } from "@/components/ui/otp-field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "./tip";
import { useT } from "@/lib/i18n";
import type { Field as FieldSpec } from "./types";

const list = (v?: string) => (v ? v.split(/\s*,\s*/).filter(Boolean) : []);
const num = (s?: string) => Number((s ?? "").replace(/[^\d.]/g, "")) || 0;

function Control({ f, id, invalid }: { f: FieldSpec; id: string; invalid: boolean }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const [picked, setPicked] = useState<string[]>(list(f.value));
  const [code, setCode] = useState(f.value ?? "");
  const off = f.disabled || f.readOnly;
  const common = { id, disabled: f.disabled, readOnly: f.readOnly, required: f.required, "aria-invalid": invalid || undefined, placeholder: f.placeholder ? t(f.placeholder) : undefined, defaultValue: f.value };
  const options = f.options ?? [];
  switch (f.kind ?? "text") {
    case "textarea": return <Textarea {...common} />;
    case "select":
      return (
        <Select defaultValue={f.value} disabled={off}>
          <SelectTrigger id={id} aria-invalid={invalid || undefined}><SelectValue placeholder={f.placeholder ? t(f.placeholder) : t("Select")} /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{t(o)}</SelectItem>)}</SelectContent>
        </Select>
      );
    case "search": case "combobox": return <Combobox id={id} options={options} value={picked} onChange={setPicked} placeholder={f.placeholder} disabled={off} />;
    case "multiselect": return <Combobox id={id} options={options} value={picked} onChange={setPicked} placeholder={f.placeholder} disabled={off} multiple />;
    case "date": return <DatePicker id={id} value={f.value} placeholder={f.placeholder} disabled={off} />;
    case "daterange": return <DatePicker id={id} value={f.value} placeholder={f.placeholder} disabled={off} range />;
    case "toggle": return <Switch id={id} defaultChecked={/^(on|yes|true)$/i.test(f.value ?? "")} disabled={off} />;
    case "radio":
      return (
        <RadioGroup defaultValue={f.value} disabled={off} aria-labelledby={`${id}-l`}>
          {options.map((o) => <Label key={o} className="font-normal"><RadioGroupItem value={o} />{t(o)}</Label>)}
        </RadioGroup>
      );
    case "checkbox":
      return (
        <div className="grid gap-2" role="group" aria-labelledby={`${id}-l`}>
          {options.map((o) => <Label key={o} className="font-normal"><Checkbox defaultChecked={list(f.value).includes(o)} disabled={off} />{t(o)}</Label>)}
        </div>
      );
    case "consent": return null; // drawn with its sentence beside the box, in Field
    case "slider": {
      const lo = num(options[0]), hi = num(options[options.length - 1]) || 100;
      return <Slider defaultValue={[f.value ? num(f.value) : lo]} min={lo} max={hi} disabled={off} aria-labelledby={`${id}-l`} />;
    }
    case "otp": return <OtpField length={f.value?.length || 6} value={code} onChange={setCode} disabled={off} labelledBy={`${id}-l`} />;
    case "card":
      return (
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
          <Input id={id} inputMode="numeric" autoComplete="cc-number" placeholder={t(f.placeholder ?? "Card number")} disabled={off} />
          <Input inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" aria-label={t("Expiry")} disabled={off} />
          <Input inputMode="numeric" autoComplete="cc-csc" placeholder="CVC" aria-label={t("Security code")} disabled={off} />
        </div>
      );
    case "password":
      return (
        <div className="relative">
          <Input {...common} type={shown ? "text" : "password"} className="pe-9" />
          <button type="button" className="absolute inset-y-0 end-0 flex w-9 items-center justify-center text-muted-foreground" aria-label={t(shown ? "Hide" : "Show")} onClick={() => setShown(!shown)}>{shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
        </div>
      );
    case "number": return <Input {...common} type="number" inputMode="decimal" />;
    case "currency": return <Input {...common} inputMode="decimal" />;
    case "phone": return <Input {...common} type="tel" autoComplete="tel" />;
    case "email": return <Input {...common} type="email" autoComplete="email" />;
    case "time": return <Input {...common} type="time" />;
    default: return <Input {...common} />;
  }
}

export function Field({ f, invalid = false }: { f: FieldSpec; invalid?: boolean }) {
  const t = useT();
  const id = useId();
  const showError = invalid && (!!f.error || !!f.required);
  if (f.kind === "consent") {
    return (
      <div className="grid gap-1.5">
        <Label className="items-start font-normal"><Checkbox defaultChecked={/^(on|yes|true)$/i.test(f.value ?? "")} disabled={f.disabled} aria-invalid={showError || undefined} />{t(f.label)}{f.required && <span className="text-destructive">*</span>}</Label>
        {showError && <p className="text-xs text-destructive">{t(f.error ?? "This is required")}</p>}
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      <Label id={`${id}-l`} htmlFor={id}>
        {t(f.label)}{f.required && <span className="text-destructive" aria-hidden>*</span>}
        {f.hint && <Tip hint={t(f.hint)}><Info className="size-3.5 text-muted-foreground" aria-label={t(f.hint)} /></Tip>}
      </Label>
      <Control f={f} id={id} invalid={showError} />
      {showError ? <p className="text-xs text-destructive">{t(f.error ?? "This is required")}</p> : f.help && <p className="text-xs text-muted-foreground">{t(f.help)}</p>}
    </div>
  );
}
