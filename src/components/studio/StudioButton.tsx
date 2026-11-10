import type { ButtonHTMLAttributes, ReactNode } from "react";

type StudioButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  icon?: ReactNode;
};

export function StudioButton({
  variant = "secondary",
  icon,
  className = "",
  children,
  type = "button",
  ...props
}: StudioButtonProps) {
  return (
    <button
      type={type}
      className={`studio-button studio-button--${variant} ${className}`.trim()}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
