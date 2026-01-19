/**
 * Loading skeleton for table page.
 *
 * AC-4.4: Suspense boundary fallback to avoid blank screen.
 */

export function TablePageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Table skeleton */}
      <div className="relative mx-auto aspect-[16/10] w-full max-w-4xl animate-pulse">
        <div className="absolute inset-0 rounded-[50%] bg-zinc-200 dark:bg-zinc-700" />
      </div>

      {/* Actions skeleton */}
      <div className="mx-auto flex w-full max-w-4xl gap-4">
        <div className="h-12 flex-1 rounded-lg bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
        <div className="h-12 flex-1 rounded-lg bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
        <div className="h-12 flex-1 rounded-lg bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
      </div>
    </div>
  );
}
