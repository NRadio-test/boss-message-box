import type { ReactNode } from "react";

interface FormFieldProps {
  index?: string;
  label: string;
  htmlFor?: string;
  required?: boolean;
  helper?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({
  index,
  label,
  htmlFor,
  required,
  helper,
  error,
  children,
  className = "",
}: FormFieldProps) {
  const Label = htmlFor ? "label" : "div";
  const helperId = htmlFor ? `${htmlFor}-helper` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div className={`form-field ${error ? "form-field--error" : ""} ${className}`.trim()}>
      <div className="field-heading">
        <Label className="field-label" {...(htmlFor ? { htmlFor } : {})}>
          {index && <span className="field-index" aria-hidden="true">{index}</span>}
          <span>{label}</span>
        </Label>
        {required && <span className="required-text">必填</span>}
      </div>
      {helper && <div className="field-helper" id={helperId}>{helper}</div>}
      {children}
      {error && <p className="field-error" id={errorId} role="alert">{error}</p>}
    </div>
  );
}
