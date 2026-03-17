import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import {
  ShieldCheck,
  FileText,
  Users,
  BarChart3,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 dark:bg-neutral-100">
            <ShieldCheck className="h-5 w-5 text-white dark:text-neutral-900" />
          </div>
          <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            GInsurance
          </span>
        </div>
        <Link
          href="/auth/signin"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Sign in
        </Link>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-20 pt-16 text-center sm:px-10 sm:pt-24">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl dark:text-neutral-100">
          Insurance management,
          <br />
          <span className="text-neutral-500 dark:text-neutral-400">simplified.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
          GInsurance is a modern platform for managing policies, clients, agents,
          and documents — all in one place. Built for teams that need clarity and
          speed.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/auth/signin"
            className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-neutral-200 bg-white px-6 py-20 sm:px-10 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Everything you need to run your book of business
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-neutral-500 dark:text-neutral-400">
            From quoting to renewals, GInsurance keeps your workflows
            organized and your data accessible.
          </p>

          <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={FileText}
              title="Policy Management"
              description="Create, track, and manage policies across every line of business with configurable workflows."
            />
            <FeatureCard
              icon={Users}
              title="Client & Agent Portal"
              description="Keep client records, agent assignments, and communication history in one central hub."
            />
            <FeatureCard
              icon={BarChart3}
              title="Documents & Reporting"
              description="Generate policy documents from templates and get visibility into your portfolio at a glance."
            />
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Built for modern insurance teams
          </h2>
          <ul className="mt-10 space-y-5">
            {[
              "Configurable policy flows and form fields — no code changes needed",
              "Role-based access for admins, agents, and internal staff",
              "PDF template generation with dynamic data binding",
              "Automated reminders and workflow actions",
              "Dark mode and responsive design for work from anywhere",
            ].map((text) => (
              <li key={text} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                <span className="text-neutral-700 dark:text-neutral-300">
                  {text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-neutral-200 bg-white px-6 py-16 text-center sm:px-10 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Ready to get started?
        </h2>
        <p className="mt-2 text-neutral-500 dark:text-neutral-400">
          Sign in to your account or contact your administrator for access.
        </p>
        <Link
          href="/auth/signin"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Sign in
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 px-6 py-8 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-neutral-400" />
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              &copy; {new Date().getFullYear()} GInsurance. All rights reserved.
            </span>
          </div>
          <div className="flex gap-6 text-sm text-neutral-500 dark:text-neutral-400">
            <Link href="/auth/signin" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Sign in
            </Link>
            <Link href="/forgot-password" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Forgot password
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
        <Icon className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
      </div>
      <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
        {description}
      </p>
    </div>
  );
}
