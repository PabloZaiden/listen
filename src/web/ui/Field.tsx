import React from "react";

interface FieldProps {
  label: string;
  htmlFor?: string;
  helpText?: string;
  errorText?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, helpText, errorText, required = false, children }: FieldProps): React.ReactElement {
  return (
    <label className="ui-field" htmlFor={htmlFor}>
      <span>{label}{required ? <span aria-hidden="true"> *</span> : null}</span>
      {children}
      {helpText ? <small>{helpText}</small> : null}
      {errorText ? <small className="ui-field-error">{errorText}</small> : null}
    </label>
  );
}
