import type { ReactNode } from "react";

type StudioPanelHeaderProps = {
  title: string;
  subtitle: string;
  trailing?: ReactNode;
};

export function StudioPanelHeader({ title, subtitle, trailing }: StudioPanelHeaderProps) {
  return (
    <div className="panel-toolbar">
      <div>
        <b>{title}</b>
        <span>{subtitle}</span>
      </div>
      {trailing}
    </div>
  );
}
