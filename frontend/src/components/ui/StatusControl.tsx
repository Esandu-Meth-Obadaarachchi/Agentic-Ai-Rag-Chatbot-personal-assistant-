"use client";

import { Check } from "lucide-react";
import { STATUSES, statusMeta, type StatusMeta } from "@/lib/constants";
import { useProjectStatuses } from "@/lib/data/WorkspaceContext";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";
import { Dropdown, MenuItem } from "./Dropdown";

/** The circular status checkbox from the tree/list rows. Click opens the picker,
 *  which lists the four built-ins plus any of the project's custom statuses. */
export function StatusControl({
  status,
  onChange,
  size = 16,
  statuses,
}: {
  status: TaskStatus;
  onChange: (s: TaskStatus) => void;
  size?: number;
  /** Override the status list (defaults to the current project's). */
  statuses?: StatusMeta[];
}) {
  const projectList = useProjectStatuses();
  const list = statuses ?? projectList;
  const meta = statusMeta(status, list);
  const done = status === "done";

  return (
    <Dropdown
      width={180}
      trigger={() => (
        <span
          className={cn(
            "grid place-items-center rounded-full border-[1.5px] transition-all",
            done ? "border-done bg-done text-bg" : meta.custom ? "" : `${meta.color} border-current`,
            status === "in_progress" && "border-progress",
            status === "blocked" && "border-blocked",
            status === "todo" && "border-todo/60"
          )}
          style={{
            width: size,
            height: size,
            ...(meta.custom ? { borderColor: meta.hex, color: meta.hex } : {}),
          }}
          title={meta.label}
        >
          {done && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
          {status === "in_progress" && <span className="h-1.5 w-1.5 rounded-full bg-progress" />}
          {status === "blocked" && <span className="h-[7px] w-[2px] rounded-full bg-blocked" />}
          {meta.custom && <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.hex }} />}
        </span>
      )}
    >
      {(close) =>
        list.map((s) => (
          <MenuItem
            key={s.id}
            active={s.id === status}
            icon={
              s.custom ? (
                <span className="h-2 w-2 rounded-full" style={{ background: s.hex }} />
              ) : (
                <span className={cn("h-2 w-2 rounded-full", s.dot)} />
              )
            }
            onClick={() => {
              onChange(s.id);
              close();
            }}
          >
            {s.label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

/** Kept for callers that only want the built-ins with no context dependency. */
export const BASE_STATUSES = STATUSES;
