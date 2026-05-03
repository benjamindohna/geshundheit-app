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

---

> This app is a personal tool and does not replace professional medical advice.
