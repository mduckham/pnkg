/** Loading placeholder shown the instant a new place is selected, shaped like real content (not a bare spinner) so the swap doesn't jump — the KG side has no equivalent, since a fake graph over the still-mounted canvas can't rule out the old one showing through. */

export function DataPanelSkeleton() {
  return (
    <div className="px-3 py-2.5 space-y-3 animate-pulse" role="status" aria-label="Loading place information">
      {/* Identity — matches MultiValuedPlacePanel's name heading + classification pill */}
      <div className="space-y-1.5">
        <div className="h-5 bg-gray-200 rounded w-3/5" />
        <div className="h-4 bg-gray-100 rounded-full w-16" />
      </div>

      {/* Status / Date Gazetted rows */}
      <div className="space-y-1.5">
        <div className="h-3 bg-gray-100 rounded w-2/5" />
        <div className="h-3 bg-gray-100 rounded w-1/3" />
      </div>

      {/* Accordion section rows — dot + label, same row shape as
          AccordionSection's own header (MultiValuedPlacePanel.tsx) */}
      <div className="divide-y divide-gray-100 border-t border-gray-100">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2 py-2">
            <div className="w-2 h-2 rounded-full bg-gray-200 shrink-0" />
            <div className="h-3 bg-gray-200 rounded" style={{ width: `${40 + (i % 3) * 15}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
