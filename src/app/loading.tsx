import { Spinner } from "@/components/brand";

// Shown while any page is loading: the*spark asterisk, turning.
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4" role="status" aria-live="polite">
      <Spinner className="h-14 w-14" />
      <p className="text-[11px] uppercase tracking-[0.16em] text-ink/50">Loading</p>
    </div>
  );
}
