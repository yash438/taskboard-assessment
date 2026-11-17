import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TaskSummary } from '../../graphql/queries';
import { priorityLabel } from './format';

// One series: one colour, no legend. Checked for contrast against the #fcfcfb card.
const BAR_COLOR = '#2a78d6';
const INK_PRIMARY = '#0b0b0b';
const INK_SECONDARY = '#52514e';
const GRID = '#e7e6e2';

export function PriorityChart({ data }: { data: TaskSummary['byPriority'] }) {
  const rows = data.map((entry) => ({ name: priorityLabel(entry.priority), count: entry.count }));

  return (
    // Same numbers as text for screen readers.
    <div role="img" aria-label={`Tasks by priority: ${rows.map((row) => `${row.name} ${row.count}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={rows} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: INK_SECONDARY, fontSize: 12 }} />
          <YAxis
            allowDecimals={false}
            width={40}
            tickLine={false}
            axisLine={false}
            tick={{ fill: INK_SECONDARY, fontSize: 12 }}
          />
          <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.04)' }} formatter={(value) => [value, 'Tasks']} />
          <Bar dataKey="count" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
            <LabelList dataKey="count" position="top" fill={INK_PRIMARY} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
