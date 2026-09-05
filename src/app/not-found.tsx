import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">הדף לא נמצא</h1>
      <p className="mt-2 text-muted-foreground">
        ייתכן שהפריט אינו קיים במאגר המקומי. נסו להרחיב את השאיבה מה־API של הכנסת.
      </p>
      <Link href="/" className="mt-6 inline-block font-medium text-primary hover:underline">
        חזרה לדף הראשי
      </Link>
    </div>
  );
}
