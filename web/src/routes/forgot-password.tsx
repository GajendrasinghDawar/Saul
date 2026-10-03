import { useState } from "react";
import { Mail, Sparkles } from "lucide-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

export const Route = createFileRoute("/forgot-password")({ component: ForgotPasswordPage });

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/forget-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo: `${window.location.origin}/reset-password` }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Unable to send reset email");
      }
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send reset email");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-svh items-center justify-center bg-slate2 p-4">
      <section className="w-full max-w-sm rounded-xl border border-slate5 bg-slate3 p-7 shadow-5">
        <div className="mb-6 flex size-10 rotate-3 items-center justify-center rounded-lg border border-crimson7 bg-crimson4 text-crimson11 shadow-2">
          <Sparkles size={19} />
        </div>

        {sent ? (
          <>
            <h1 className="text-2xl font-bold text-slate12">Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate10">
              We sent a password reset link to <strong className="text-slate12">{email}</strong>. 
              Check your inbox and click the link to reset your password.
            </p>
            <Link to="/login">
              <Button className="mt-6 w-full" variant="secondary">
                Back to sign in
              </Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate12">Forgot your password?</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate10">
              Enter your email and we'll send you a reset link.
            </p>

            <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate11">Email</label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <Button className="w-full" variant="primary" disabled={isSubmitting} type="submit">
                <Mail size={17} />
                {isSubmitting ? "Sending..." : "Send reset link"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-slate10">
              Remember your password?{" "}
              <Link to="/login" className="text-crimson11 hover:text-crimson10 hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-md border border-red7 bg-red3 p-3 text-sm text-red11">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
