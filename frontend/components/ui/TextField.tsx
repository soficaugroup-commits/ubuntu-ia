import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";

type Shared = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

type InputProps = Shared &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
    multiline?: false;
    controlRef?: Ref<HTMLInputElement>;
  };

type AreaProps = Shared &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
    multiline: true;
    controlRef?: Ref<HTMLTextAreaElement>;
  };

export function TextField(props: InputProps | AreaProps) {
  const { id, label, hint, error, className = "" } = props;
  const describedBy = [
    hint ? `${id}-hint` : null,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  const fieldClass = `w-full rounded-surface border-0 bg-canvas px-4 py-3 text-content placeholder:text-content-muted neo-pressed ${
    error ? "outline outline-2 outline-accent" : ""
  } ${className}`;

  let control: ReactNode;
  if (props.multiline) {
    const { multiline: _m, label: _l, hint: _h, error: _e, controlRef, ...areaProps } = props;
    control = <textarea {...areaProps} ref={controlRef} id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy} className={`${fieldClass} min-h-24 resize-y`} />;
  } else {
    const { multiline: _m, label: _l, hint: _h, error: _e, controlRef, ...inputProps } = props;
    control = <input {...inputProps} ref={controlRef} id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy} className={fieldClass} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-content">
        {label}
      </label>
      {control}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-content-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-accent-hover" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
