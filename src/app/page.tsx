import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button'; 

export default async function Home() {
  const supabase = await createClient();

  const { data: { session } } = await supabase.auth.getSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Inbox Concierge</h1>

      {session ? (
        <div className="flex flex-col items-center gap-4">
          <p>Welcome back!</p>
          <Button asChild>
            <Link href="/inbox">Go to Inbox</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <p>Please log in to manage your inbox.</p>
          <Button asChild>
            <Link href="/auth/login">Login with Google</Link>
          </Button>
        </div>
      )}
    </main>
  );
}
