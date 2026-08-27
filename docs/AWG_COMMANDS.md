# NASA OSDR Analysis Working Group (AWG) Command Reference

The **Analysis Working Group (AWG)** command suite in **OSDR_Chatbot** enables cross-study multi-omics co-analysis, pathway convergence mapping, and evidence-grounded scientific synthesis directly from NASA Open Science Data Repository accessions.

---

## Quick-Start Commands

| Command | Action | Example | Status |
|---|---|---|---|
| `/awg compare <OSD-A> <OSD-B>` | Co-analyze two OSDR studies across omics layers, tissues, or flight factors | `/awg compare OSD-679 OSD-680` | **Implemented** |
| `/awg compare OSD-679 OSD-681` | Compare transcriptomic regulation against downstream metabolomic profiles | `/awg compare OSD-679 OSD-681` | **Implemented** |
| `/awg analyze <OSD-ID>` | Perform in-depth single-study breakdown and resolve complementary pairings | `/awg analyze OSD-583` | **Implemented** |
| `/awg summary <OSD-ID>` | Produce structured executive accession summary with metadata provenance | `/awg summary OSD-679` | **Implemented** |
| `/awg suggest` | Discover recommended complementary cross-omics pairs in the dataset | `/awg suggest` | **Implemented** |
| `/awg help` | Display in-app command manual, evidence rules, and supported workflows | `/awg help` | **Implemented** |
| `/awg export <format>` | Export multi-omics comparison matrices to CSV / JSON / PDF | `/awg export json` | *Planned* |
| `/awg pathway <pathway-name>` | Targeted pathway query across all indexed flight accessions | `/awg pathway NF-kB` | *Planned* |
| `/awg countermeasure <target>` | Candidate countermeasure mapping against molecular targets | `/awg countermeasure VEGF` | *Planned* |

---

## Command Workflows

### 1. Cross-Study Comparison (`/awg compare`)

Co-analyzes two distinct NASA OSDR studies, resolving their experimental designs, shared phenotypes, and complementary assay layers.

```text
/awg compare OSD-679 OSD-680
```
- **Study A (OSD-679)**: Spaceflight & Head-Down Tilt (HDT) ocular transcriptomics (RNA-seq).
- **Study B (OSD-680)**: Head-Down Tilt retinal proteomics (LC-MS/MS).
- **Synthesis Outcome**: Identifies upstream gene regulation (angiogenesis, ECM remodeling) aligning with downstream structural protein breakdown under cephalad fluid shifts.

```text
/awg compare OSD-679 OSD-681
```
- **Study A (OSD-679)**: Retinal RNA-seq transcriptomics.
- **Study B (OSD-681)**: Retinal metabolite profiling.
- **Synthesis Outcome**: Correlates vascular apoptosis markers with bioenergetic ATP depletion and lipid peroxidation.

### 2. Single-Study In-Depth Analysis (`/awg analyze`)

Parses a specific accession and automatically matches it with the most complementary counterpart in the repository.

```text
/awg analyze OSD-583
```
- Evaluates rodent hindlimb unloading transcriptomics and pairs it with matching muscular/neurological assays.

### 3. Study Suggestions (`/awg suggest`)

Queries the repository for high-value multi-omics pairs sharing identical flight factors (e.g., microgravity, galactic cosmic radiation, or ground analogs) and model organisms.

---

## Evidence Classification Rules

Every AWG output strictly categorizes scientific statements:

1. **Observed Study Evidence**: Direct, empirical measurements reported in verified OSDR repository records (e.g., organism, tissue, assay platform, factor duration).
2. **Evidence-Informed Synthesis**: Cross-study correlation and pathway inferences derived from comparing complementary datasets.
3. **Investigative Translational Targets**: Hypothesized biological mechanisms and countermeasure directions for future exploration.

---

## Epistemic Boundary

Generated AWG comparisons, diagrams, and motion briefs are research-support communication tools. They synthesize empirical metadata from NASA OSDR accessions but do not constitute clinical recommendations or raw primary sequencing reads.
