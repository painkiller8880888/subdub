import { createElement, type ReactElement } from "react";

export function TerminologyStatusError({
  message
}: {
  message: string | null;
}): ReactElement | null {
  return message
    ? createElement("p", { className: "form-error", role: "alert" }, message)
    : null;
}
