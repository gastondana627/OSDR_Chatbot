# Contributing to NASA OSDR ChatBot & AWG Evidence Engine

Thank you for helping grow an open-source, evidence-grounded workspace for the **NASA Open Science Data Repository (OSDR)** and **Analysis Working Group (AWG)** community! Whether you are a space biologist, ML researcher, student, or software engineer, you can contribute directly without any heavy setup.

---

## 1. Fastest Way to Add Your Work (No Code Required, ~60 Seconds)

If you have built a digital twin, Colab/Jupyter notebook, benchmark dataset, visualization app, or preprint you want surfaced alongside OSDR studies:

1. Open the live **Contributor Hub**: https://osdr-chatbot-kappa.vercel.app/contributors
2. *(Optional)* If you signed in on `/account` and checked off your AWG subgroups, click **Fill from My AWG Profile** to populate your name, handle, affiliation, and ORCID in one click.
3. Enter your project title, short summary, live demo or repository URL, and target `OSD-*` study IDs.
4. Click **Generate Manifest** to produce a standardized `contributor_manifest.json` and a ready-to-paste **GitHub PR / AWG Forum block**.
5. Click **Save Local Preview** to inspect how your card looks immediately, then open a GitHub Issue or PR pasting the generated block so we can add your entry to [`server/communityIntegrations.ts`](server/communityIntegrations.ts).

---

## 2. Contributing Code, Study Manifests, or Tests

### Local Development Setup
```bash
git clone https://github.com/gastondana627/OSDR_Chatbot.git
cd OSDR_Chatbot
npm install
cp .env.example .env   # Optional: offline RAG + all 19 test suites run with zero API keys
npm run dev
```
The app runs at `http://localhost:3000`.

### Running the Full Test & Typecheck Suite
Before opening a Pull Request, please verify all 19 test suites, production build, and TypeScript checks pass:
```bash
npm test
npm run build
npm run lint
```

### Pull Request Checklist
- **Scientific Integrity First:** Never invent or silently substitute `OSD-*` accession metadata, sample counts, assay types, or DOIs. Keep repository-verified metadata strictly separated from model interpretation and follow-up hypotheses.
- **Zero-Key Determinism:** All automated tests must pass cleanly without requiring paid API keys.
- **No Secrets in Git:** Never commit `.env`, API keys, or service-account JSON files.
- **Clean Scope:** Keep PRs focused on a single feature, study manifest update, or bug fix, and include a test in `tests/` when adding backend logic.

---

## 3. Reporting Bugs or Requesting Features (Including Login Providers)

Open a GitHub Issue at https://github.com/gastondana627/OSDR_Chatbot/issues with:
- What you expected vs. what happened (include the study ID, command, or route such as `/`, `/account`, or `/contributors`).
- **Feature & Login Provider Requests:** Currently Email/Password and Google Sign-In are live on `/account`. Let us know in an Issue or the AWG forum if you want **GitHub**, **Microsoft / institutional SSO**, **Apple**, or additional AWG subgroup presets added next!

---

## 4. Community Standards & Attribution

- Be welcoming, constructive, and respectful across disciplines (wet-lab biologists, clinicians, data scientists, and first-time contributors).
- Independent tools and prototypes showcased in `/contributors` remain credited to their respective authors with explicit provenance and are not officially endorsed by NASA.
- All code contributions are licensed under the repository's [MIT License](LICENSE).
