import {
  ExtractedEventSchema,
  type ExtractedEvent,
} from "@/lib/schema";
import {
  addDaysToYMD,
  addOneHourLocal,
  isoToDate,
  isoToDatetimeLocal,
  localToJSTISO,
  nowJSTLocal,
} from "@/lib/preview-datetime";
import type { EventFormState } from "./types";

export function emptyForm(): EventFormState {
  const startLocal = nowJSTLocal();
  return {
    title: "",
    startLocal,
    endLocal: addOneHourLocal(startLocal),
    isAllDay: false,
    location: "",
    url: "",
    description: "",
  };
}

export function eventToForm(event: ExtractedEvent): EventFormState {
  return {
    title: event.title,
    startLocal: event.isAllDay
      ? isoToDate(event.startISO)
      : isoToDatetimeLocal(event.startISO),
    endLocal: event.isAllDay
      ? addDaysToYMD(isoToDate(event.endISO), -1)
      : isoToDatetimeLocal(event.endISO),
    isAllDay: event.isAllDay,
    location: event.location ?? "",
    url: event.url ?? "",
    description: event.description ?? "",
  };
}

export function formToEvent(
  form: EventFormState,
): { ok: true; event: ExtractedEvent } | { ok: false; error: string } {
  const startISO = localToJSTISO(form.startLocal, form.isAllDay);
  const endLocal = form.isAllDay
    ? addDaysToYMD(form.endLocal, 1)
    : form.endLocal;
  const endISO = localToJSTISO(endLocal, form.isAllDay);

  const parsed = ExtractedEventSchema.safeParse({
    title: form.title.trim(),
    startISO,
    endISO,
    isAllDay: form.isAllDay,
    location: form.location.trim() ? form.location.trim() : null,
    url: form.url.trim() ? form.url.trim() : null,
    description: form.description.trim() ? form.description.trim() : null,
  });
  return parsed.success
    ? { ok: true, event: parsed.data }
    : { ok: false, error: "入力内容を確認してください。" };
}
