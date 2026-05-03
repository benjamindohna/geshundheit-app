# Gesundheits-App

Personal health dashboard for tracking and analyzing health data over time.

## What it does

- Upload scanned health documents (PDFs, JPEGs) — bloodwork, body measurements, etc.
- Claude AI extracts values automatically from documents
- Dashboard shows a summary of your health status with clinically-ranked critical values
- Personalized recommendations for sport, nutrition, and supplements based on your data
- Chat interface to ask Claude directly about your own health data
- Confidence / data freshness tracking so you always know how current your values are

## Tech Stack

- **Frontend + API:** Next.js (deployed on Vercel)
- **Database + Storage:** Supabase (PostgreSQL + file storage for PDFs/JPEGs)
- **AI:** Claude API (document extraction, analysis, recommendations, chat)
- **Auth:** Password-only login

## Status

In development.

> This app is a personal tool and does not replace professional medical advice.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
