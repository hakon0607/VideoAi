'use client';

import { cn } from '@/lib/utils/cn';

export interface Column<T> {
  key: string;
  header: string;
  /** Right-aligns and uses tabular figures. */
  numeric?: boolean;
  width?: string;
  render: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  onRowClick,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty: string;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-[12.5px] text-ink-faint">
        {empty}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-max border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-base/60">
            {columns.map((column) => (
              <th
                key={column.key}
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  'px-3 py-2 text-left text-[10.5px] font-medium tracking-wider text-ink-faint uppercase whitespace-nowrap',
                  column.numeric ? 'text-right' : '',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-line/60 last:border-b-0',
                onRowClick ? 'cursor-pointer transition-colors hover:bg-elevated' : '',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn('px-3 py-2 align-middle', column.numeric ? 'text-right tabular-nums' : '')}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
