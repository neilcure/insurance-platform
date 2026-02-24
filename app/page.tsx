import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import HomeHero from "@/components/home/home-hero";
import HomeActions from "@/components/home/home-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ModeToggle } from "@/components/ui/mode-toggle";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const user = session?.user as (Session["user"] & { userType?: string }) | undefined;

  return (
    <main className="mx-auto max-w-6xl px-6">
      <div className="flex items-center justify-end pt-6">
        <ModeToggle />
      </div>
      <HomeHero />
      <Card className="mx-auto max-w-3xl">
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-3">
            {user ? (
              <>
                <div className="text-sm text-neutral-600">You are signed in.</div>
                <Separator />
                <div className="flex items-center gap-2">
                  <span className="text-sm">Role</span>
                  <Badge>{user.userType ?? "user"}</Badge>
                </div>
              </>
            ) : (
              <div className="text-sm text-neutral-600">
                Sign in or seed demo data to explore the app.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <HomeActions isLoggedIn={!!user} role={user?.userType} />
    </main>
  );
}
