"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Surface } from "@/components/ui/Surface";
import { Tooltip } from "@/components/ui/Tooltip";
import { copy } from "@/content/fr";

type Option = { value: string; label: string };

type Props = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  value?: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  onChange?: (value: string) => void;
};

function readOptions(children: ReactNode): Option[] {
  const items: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode }>(child)) return;
    items.push({
      value: String(child.props.value ?? ""),
      label: String(child.props.children ?? ""),
    });
  });
  return items;
}

export function SelectField({
  id,
  label,
  hint,
  error,
  value,
  disabled = false,
  className = "",
  children,
  onChange,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const options = useMemo(() => readOptions(children), [children]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((item) => item.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options[selectedIndex];

  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    listRef.current?.focus();
  }, [open, selectedIndex]);

  function choose(index: number) {
    const next = options[index];
    if (!next || disabled) return;
    onChange?.(next.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(selectedIndex);
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(options.length - 1, current + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    }
  }

  return (
    <div ref={rootRef} className={`relative flex flex-col gap-1.5 ${className || "max-w-xs"}`}>
      <label htmlFor={id} className="text-sm font-semibold text-content">
        {label}
      </label>
      <Tooltip label={copy.tips.selectOpen} className="w-full">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        onClick={() => !disabled && setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        className={`neo-pressed flex min-h-11 w-full items-center justify-between gap-3 rounded-full border-0 bg-canvas px-4 py-2.5 text-left text-content ${
          error ? "outline outline-2 outline-accent" : ""
        }`}
      >
        <span>{selected?.label ?? ""}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 8"
          className={`h-3 w-3 shrink-0 text-content transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M1.2 1.4 6 6.2l4.8-4.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      </Tooltip>
      {open ? (
        <Surface
          elevation="raised"
          radius="card"
          className="absolute top-full z-30 mt-2 w-full p-2"
        >
          <ul
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={id}
            aria-activedescendant={`${listId}-${activeIndex}`}
            ref={listRef}
            className="flex flex-col gap-1 outline-none"
            onKeyDown={onListKeyDown}
          >
            {options.map((option, index) => {
              const isSelected = option.value === selected?.value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={option.value || index}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={`cursor-pointer rounded-full px-4 py-2 text-sm font-medium ${
                    isSelected
                      ? "neo-pressed text-content"
                      : isActive
                        ? "neo-soft text-content"
                        : "text-content-muted"
                  }`}
                >
                  {option.label}
                </li>
              );
            })}
          </ul>
        </Surface>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-content-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          className="text-sm font-medium text-accent-hover"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
