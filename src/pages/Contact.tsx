import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Mail, MessageSquare, Send } from "lucide-react";
import { Link } from "react-router";
import { api } from "@/convex/_generated/api";
import { Footer } from "@/components/site/Footer";
import { Navbar } from "@/components/site/Navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CHANNELS = [
  {
    icon: Mail,
    title: "Email-style messages",
    body: "Use the form — it lands straight in our inbox with your reply address attached.",
  },
  {
    icon: Clock,
    title: "Response time",
    body: "We answer within two working days. Detection bugs and false verdicts jump the queue.",
  },
  {
    icon: MessageSquare,
    title: "False verdicts",
    body: "Include the result link from your dashboard and what the file actually was — that feedback directly retrains our thresholds.",
  },
];

export default function Contact() {
  const submit = useMutation(api.contact.submit);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await submit({ name, email, message });
      setSent(true);
      toast.success("Message sent — we'll reply by email.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not send the message.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6">
        <header className="rule-double pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Get in touch
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Contact
          </h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            Questions about a verdict, a bug, a false positive, or using
            TruthLens in a newsroom or classroom — send it here.
          </p>
        </header>

        <div className="mt-10 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Card className="paper-grain border-border/70 shadow-none">
              <CardHeader>
                <CardTitle className="font-display text-lg">
                  Send a message
                </CardTitle>
                <CardDescription>
                  Ten characters minimum, so we can actually help.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sent ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-[var(--verdict-real)]/10 text-[var(--verdict-real)]">
                      <CheckCircle2 className="size-6" />
                    </div>
                    <p className="font-display text-lg font-semibold">
                      Message received
                    </p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Thanks, {name.split(" ")[0] || "friend"} — we will reply to{" "}
                      {email} within two working days.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 cursor-pointer"
                      onClick={() => {
                        setSent(false);
                        setMessage("");
                      }}
                    >
                      Send another
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="contact-name">Name</Label>
                        <Input
                          id="contact-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Your name"
                          required
                          maxLength={80}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="contact-email">Email</Label>
                        <Input
                          id="contact-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          required
                          maxLength={200}
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="contact-message">Message</Label>
                      <Textarea
                        id="contact-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="What can we help with? (at least 10 characters)"
                        required
                        minLength={10}
                        maxLength={4000}
                        rows={7}
                      />
                    </div>
                    <Button
                      type="submit"
                      className="cursor-pointer gap-2"
                      disabled={sending}
                    >
                      {sending ? (
                        <>
                          <Send className="size-4 animate-pulse" /> Sending…
                        </>
                      ) : (
                        <>
                          <Send className="size-4" /> Send message
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 lg:col-span-2">
            {CHANNELS.map((c) => (
              <Card key={c.title} className="border-border/70 shadow-none">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <c.icon className="size-4 text-primary" />
                    <CardTitle className="font-display text-base">
                      {c.title}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {c.body}
                </CardContent>
              </Card>
            ))}
            <Card className="border-border/70 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base">
                  Quick links
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <Link
                  to="/docs"
                  className="text-primary underline underline-offset-4"
                >
                  API reference
                </Link>
                <Link
                  to="/learn"
                  className="text-primary underline underline-offset-4"
                >
                  Field guide on fake media
                </Link>
                <Link
                  to="/about"
                  className="text-primary underline underline-offset-4"
                >
                  How detection works
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
