import { Wordmark, SparkMark } from "@/components/brand";

export const metadata = { title: "Offline · the*spark" };

export default function Offline() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <SparkMark className="h-12 w-12 text-spark spark-spin [animation-duration:4s]" />
      <h1 className="mt-6 text-2xl font-light uppercase">You&apos;re offline</h1>
      <p className="mt-2 text-sm text-ink/60">Bookings are live, so we need a connection. We&apos;ll be right here when you&apos;re back.</p>
      <span className="mt-10 text-3xl"><Wordmark sub /></span>
    </div>
  );
}
