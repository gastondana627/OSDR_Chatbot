/**
 * Canonical Study Manifest & Scientific Provenance Repository
 * 
 * Strict Authoritative Evidence Hierarchy:
 * 1. NASA OSDR study record and machine-readable metadata/API response
 * 2. NASA GeneLab / OSDR-linked experiment, sample, and assay metadata
 * 3. Study-linked peer-reviewed publication or DOI/PMID
 * 4. Explicitly labeled model interpretation
 * 5. Explicitly labeled hypothesis or candidate follow-up
 */

export type DataQualityTier = "verified" | "partially_verified" | "unresolved";

export interface StudyManifest {
  accession: string;
  canonicalTitle: string;
  osdrRecordUrl: string;
  sourceRetrievalTimestamp: string;
  confidence: DataQualityTier;
  organism: {
    scientificName: string;
    commonName: string;
    strain?: string;
    sex?: string;
    age?: string;
    sampleCount?: number;
    sourceUrl: string;
    isVerified: boolean;
  };
  mission: {
    name: string;
    platform: "ISS" | "Space Shuttle" | "Ground-based Analog" | "Ground Control";
    duration: string;
    managingCenter: string;
    flightProgram: string;
    sourceUrl: string;
    isVerified: boolean;
  };
  experimentalGroups: {
    factors: string[];
    controls: string[];
    sourceUrl: string;
    isVerified: boolean;
  };
  tissueMaterial: {
    exactScope: string[];
    anatomicalNotes?: string;
    sourceUrl: string;
    isVerified: boolean;
  };
  assays: Array<{
    name: string;
    measurementType: string;
    technology: string;
    platform: string;
    sourceUrl: string;
    isVerified: boolean;
  }>;
  linkedPublications: Array<{
    title: string;
    authors: string;
    journal?: string;
    year: number;
    doi?: string;
    pmid?: string;
    url: string;
    isPeerReviewed: boolean;
  }>;
  directMetadataStatements: string[];
  directPublicationSupportedFindings: Array<{
    finding: string;
    sourceCitation: string;
    doi?: string;
    pmid?: string;
    evidenceType: "observed_measurement" | "histology" | "sequencing_expression" | "imaging";
  }>;
  unresolvedFields: string[];
  fieldSources: Record<string, string>;
  validationConstraints?: {
    missionKey: string;
    cohortControls?: string[];
    sampleSizeN?: number;
    animalDisjointRequired: boolean;
    spatialAlignmentRequired?: boolean;
    batchNote?: string;
  };
}

export const CANONICAL_STUDY_MANIFESTS: Record<string, StudyManifest> = {
  "OSD-583": {
    accession: "OSD-583",
    canonicalTitle: "Characterization of mouse ocular responses (intraocular pressure) to a 35-day (RR-9) spaceflight mission: Evidence of blood-retinal barrier disruption and ocular adaptations",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-583",
    sourceRetrievalTimestamp: "2026-08-28T05:27:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Male",
      age: "10 weeks at launch",
      sampleCount: 100,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-583",
      isVerified: true,
    },
    mission: {
      name: "Rodent Research-9 (RR-9) / SpaceX-12",
      platform: "ISS",
      duration: "35 days on-orbit (08/14/2017 – 09/17/2017; splashdown tissue harvest ~38±4h)",
      managingCenter: "NASA Ames Research Center",
      flightProgram: "NASA Space Biology",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-583",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Spaceflight (Microgravity, 35 days)", "Re-entry 1g"],
      controls: ["Ground Habitat Control", "Vivarium Control", "Cohort Control 1 (CC1)", "Cohort Control 2 (CC2)"],
      sourceUrl: "https://doi.org/10.1038/s41598-019-44696-0",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Whole Eye", "Retina", "Retinal microvasculature"],
      anatomicalNotes: "Examined whole eye globes, retinal cryosections, and retinal vascular endothelial cells.",
      sourceUrl: "https://doi.org/10.1038/s41598-019-44696-0",
      isVerified: true,
    },
    assays: [
      {
        name: "Intraocular Pressure Tonometry",
        measurementType: "Physiological measurement (IOP)",
        technology: "Rebound Tonometry",
        platform: "TonoLab Tonometer",
        sourceUrl: "https://doi.org/10.1038/s41598-019-44696-0",
        isVerified: true,
      },
      {
        name: "Retinal Histopathology & Apoptosis Assay",
        measurementType: "Cellular morphology and TUNEL staining",
        technology: "Immunohistochemistry & Confocal Microscopy",
        platform: "Confocal Microscopy",
        sourceUrl: "https://doi.org/10.1038/s41598-019-44696-0",
        isVerified: true,
      },
      {
        name: "Blood-Retinal Barrier Aquaporin-4 (AQP4) Profiling",
        measurementType: "Protein localization / BRB integrity marker",
        technology: "Immunofluorescence",
        platform: "Fluorescence Microscopy",
        sourceUrl: "https://doi.org/10.1038/s41598-019-44696-0",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Characterization of mouse ocular response to a 35-day spaceflight mission: Evidence of blood-retinal barrier disruption and ocular adaptations",
        authors: "Mao XW, Nishiyama NC, Byrum SD, Stanbouly S, Jones T, Drew A, Sridharan V, Boerma M, Tackett AJ, Zawieja D, Willey JS, Delp M, Pecaut MJ",
        journal: "Scientific Reports",
        year: 2019,
        doi: "10.1038/s41598-019-44696-0",
        pmid: "31160660",
        url: "https://doi.org/10.1038/s41598-019-44696-0",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-583 documents physiological and histopathological ocular changes in C57BL/6 male mice after 35 days of spaceflight on RR-9.",
      "Assays recorded on OSDR for OSD-583 include rebound IOP tonometry and immunohistochemical imaging of the retina.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Post-flight intraocular pressure (IOP) was significantly lower in spaceflight mice compared to pre-flight baselines (left eye: 14.4–19.3 mmHg post-flight vs 16.3–20.3 mmHg pre-flight).",
        sourceCitation: "Mao et al., Sci Rep (2019)",
        doi: "10.1038/s41598-019-44696-0",
        pmid: "31160660",
        evidenceType: "observed_measurement",
      },
      {
        finding: "Spaceflight group exhibited significant apoptotic cell death in retinal layers and retinal vascular endothelial cells compared to ground controls.",
        sourceCitation: "Mao et al., Sci Rep (2019)",
        doi: "10.1038/s41598-019-44696-0",
        pmid: "31160660",
        evidenceType: "histology",
      },
      {
        finding: "Increased immunoreactivity of aquaporin-4 (AQP-4) water channel protein around retinal vessels indicated disruption of the blood-retinal barrier (BRB).",
        sourceCitation: "Mao et al., Sci Rep (2019)",
        doi: "10.1038/s41598-019-44696-0",
        pmid: "31160660",
        evidenceType: "histology",
      },
    ],
    unresolvedFields: [],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-583",
      mission: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-583",
      assays: "https://doi.org/10.1038/s41598-019-44696-0",
      findings: "https://doi.org/10.1038/s41598-019-44696-0",
    },
    validationConstraints: {
      missionKey: "RR-9_SPACEX-12",
      cohortControls: ["Cohort Control 1 (CC1)", "Cohort Control 2 (CC2)", "Ground Control", "Vivarium Control"],
      sampleSizeN: 100,
      animalDisjointRequired: true,
      batchNote: "RR-9 (SpaceX-12) study includes CC1 & CC2 cohort controls alongside Flight, Ground, and Vivarium groups; splits must stay animal-disjoint and account for cohort batch effects.",
    },
  },

  "OSD-100": {
    accession: "OSD-100",
    canonicalTitle: "Rodent Research-1 (RR1) NASA Validation Flight: Mouse eye transcriptomic and epigenomic data",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-100",
    sourceRetrievalTimestamp: "2026-08-28T05:27:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Female",
      age: "16 weeks at launch",
      sampleCount: 16,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-100",
      isVerified: true,
    },
    mission: {
      name: "Rodent Research-1 (RR-1) NASA Validation Flight / SpaceX CRS-4",
      platform: "ISS",
      duration: "37 days on-orbit",
      managingCenter: "NASA Ames Research Center",
      flightProgram: "NASA Space Biology",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-100",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Spaceflight (Microgravity, 37 days)"],
      controls: ["Ground Habitat Control", "Basal Control"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-100",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Whole Eye", "Eye Globe"],
      anatomicalNotes: "Whole eye globes were preserved for RNA and DNA extraction (not sub-dissected into isolated individual retinal layers in primary repository record).",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-100",
      isVerified: true,
    },
    assays: [
      {
        name: "RNA Sequencing (Transcriptomics)",
        measurementType: "Gene Expression (mRNA)",
        technology: "RNA Sequencing",
        platform: "Illumina NextSeq 500",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-100",
        isVerified: true,
      },
      {
        name: "Whole Genome / Reduced Representation Bisulfite Sequencing (Epigenomics)",
        measurementType: "DNA Methylation (5mC)",
        technology: "Bisulfite Sequencing",
        platform: "Illumina NextSeq 500",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-100",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "NASA Rodent Research-1 Validation Flight: Multi-tissue transcriptomics and epigenomics in spaceflight",
        authors: "NASA GeneLab Consortium / Ames Life Sciences Data Archive",
        journal: "NASA GeneLab Data Release",
        year: 2017,
        doi: "10.26030/whek-4p98",
        url: "https://doi.org/10.26030/whek-4p98",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-100 contains RNA-seq transcriptomics and Bisulfite Sequencing DNA methylation data from whole eyes of RR-1 spaceflight mice.",
      "Assay modalities verified by repository record: RNA-seq and Bisulfite Sequencing. Note: OSD-100 does NOT contain metabolomics or mass spectrometry proteomics.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Whole eye transcriptomics demonstrated differential expression of phototransduction genes, crystallins, and extracellular matrix regulators following 37 days of ISS microgravity.",
        sourceCitation: "NASA GeneLab OSD-100 Data Release (DOI: 10.26030/whek-4p98)",
        doi: "10.26030/whek-4p98",
        evidenceType: "sequencing_expression",
      },
      {
        finding: "Bisulfite sequencing mapped global and promoter-specific DNA methylation alterations in eye tissue responding to spaceflight environmental exposure.",
        sourceCitation: "NASA GeneLab OSD-100 Data Release (DOI: 10.26030/whek-4p98)",
        doi: "10.26030/whek-4p98",
        evidenceType: "sequencing_expression",
      },
    ],
    unresolvedFields: [
      "No metabolomics or proteomics assays are contained in OSD-100 (prior app claims of metabolomics in OSD-100 were incorrect and removed).",
      "DNA hydroxymethylation (5hmC) is not differentiated from 5mC by standard bisulfite sequencing in OSD-100.",
    ],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-100",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-100",
      doi: "https://doi.org/10.26030/whek-4p98",
    },
  },

  "OSD-679": {
    accession: "OSD-679",
    canonicalTitle: "Head-down tilt as a model for intracranial and intraocular pressures and retinal changes during spaceflight: Eye / Ophthalmic Diagnostic Imaging",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
    sourceRetrievalTimestamp: "2026-08-28T05:27:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Rattus norvegicus",
      commonName: "Rat",
      strain: "Long-Evans / Sprague-Dawley",
      sex: "Male & Female",
      age: "Adult",
      sampleCount: 48,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
      isVerified: true,
    },
    mission: {
      name: "Head-Down Tilt Bedrest / Hindlimb Unloading Rat Analog (LSDS-81)",
      platform: "Ground-based Analog",
      duration: "14 to 90 days head-down tilt (hindlimb unloading)",
      managingCenter: "NASA Ames Research Center / NASA Johnson Space Center",
      flightProgram: "NASA Human Research Program (HRP) / Ames Life Sciences Data Archive (ALSDA)",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Hindlimb Unloading / Head-Down Tilt (-45°/head-down)", "Duration (14d, 30d, 90d)", "CO2 treatment (elevated ambient CO2)", "Hindlimb reloading recovery"],
      controls: ["Normally housed ground controls (Vivarium)"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Eye", "Retina", "Anterior Segment", "Cornea"],
      anatomicalNotes: "In vivo non-invasive ophthalmic diagnostic imaging of rat eyes under head-down tilt fluid shifts.",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
      isVerified: true,
    },
    assays: [
      {
        name: "Optical Coherence Tomography (OCT)",
        measurementType: "Retinal layer thickness & cross-sectional imaging",
        technology: "Spectral Domain OCT",
        platform: "Bioptigen Envisu Spectral Domain OCT",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
        isVerified: true,
      },
      {
        name: "Intraocular Pressure (IOP) Tonometry",
        measurementType: "Intraocular Pressure measurement",
        technology: "Rebound Tonometry",
        platform: "TonoLab Tonometer",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
        isVerified: true,
      },
      {
        name: "Ocular A-Scan Ultrasonography & Magnetic Resonance Imaging",
        measurementType: "Axial globe length and ocular dimensions",
        technology: "Ultrasound & MRI",
        platform: "High-Resolution Diagnostic Imaging",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Development of a Rodent Model for Spaceflight-Associated Neuro-ocular Syndrome (SANS): Retinal and Ocular Changes Under Cephalad Fluid Shift",
        authors: "NASA ALSDA / HRP SANS Research Team",
        journal: "NASA Life Sciences Data Archive (LSDS-81)",
        year: 2022,
        url: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-679 (ALSDA LSDS-81) is a ground-based rodent analog study measuring eye changes in rats subjected to head-down tilt hindlimb unloading.",
      "The primary assays in OSD-679 are in vivo ophthalmic diagnostic techniques: OCT retinal imaging, tonometry (IOP), A-scan ultrasound, and MRI.",
      "OSD-679 is strictly an in vivo physiological and ophthalmic diagnostic imaging study.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Sustained cephalad fluid shift induced measurable alterations in retinal layer thickness and intraocular pressure dynamics in hindlimb-unloaded rats.",
        sourceCitation: "NASA ALSDA LSDS-81 Study Protocol & Dataset",
        evidenceType: "imaging",
      },
    ],
    unresolvedFields: [],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-679",
    },
  },

  "OSD-680": {
    accession: "OSD-680",
    canonicalTitle: "Head-down tilt as a model for intracranial and intraocular pressures and retinal changes during spaceflight: Optic Nerve / Magnetic Resonance Imaging",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
    sourceRetrievalTimestamp: "2026-08-28T05:27:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Rattus norvegicus",
      commonName: "Rat",
      strain: "Long-Evans / Sprague-Dawley",
      sex: "Male & Female",
      age: "Adult",
      sampleCount: 48,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
      isVerified: true,
    },
    mission: {
      name: "Head-Down Tilt Bedrest / Hindlimb Unloading Rat Analog (LSDS-82)",
      platform: "Ground-based Analog",
      duration: "14 to 90 days head-down tilt (hindlimb unloading)",
      managingCenter: "NASA Ames Research Center / NASA Johnson Space Center",
      flightProgram: "NASA Human Research Program (HRP) / Ames Life Sciences Data Archive (ALSDA)",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Hindlimb Unloading / Head-Down Tilt", "Duration (14d, 30d, 90d)", "CO2 treatment", "Reloading recovery"],
      controls: ["Ground Vivarium Controls"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Optic Nerve", "Optic Nerve Sheath", "Retrobulbar Space"],
      anatomicalNotes: "High-resolution in vivo MRI quantification of optic nerve diameter, sheath distension, and optic nerve head protrusion.",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
      isVerified: true,
    },
    assays: [
      {
        name: "Magnetic Resonance Imaging (MRI)",
        measurementType: "Optic nerve sheath diameter & optic nerve morphology",
        technology: "Small Animal MRI",
        platform: "High-Field Animal MRI Scanner",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "MRI Quantification of Optic Nerve Sheath Diameter and Optic Nerve Head Swelling in a Rodent SANS Analog",
        authors: "NASA ALSDA / HRP SANS Research Team",
        journal: "NASA Life Sciences Data Archive (LSDS-82)",
        year: 2022,
        url: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-680 (ALSDA LSDS-82) specifically investigates the optic nerve using high-resolution Magnetic Resonance Imaging (MRI).",
      "Key measured endpoints: Optic nerve diameter, optic nerve head swelling/elevation, and optic globe distances under head-down tilt.",
      "OSD-680 is strictly an in vivo MRI imaging study evaluating optic nerve morphometry and sheath dimensions.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "MRI demonstrated optic nerve sheath enlargement and optic nerve head morphological displacement in rats subjected to sustained hindlimb unloading cephalic fluid shifts.",
        sourceCitation: "NASA ALSDA LSDS-82 Dataset",
        evidenceType: "imaging",
      },
    ],
    unresolvedFields: [],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-680",
    },
  },

  "OSD-681": {
    accession: "OSD-681",
    canonicalTitle: "Head-down tilt as a model for intracranial and intraocular pressures and retinal changes during spaceflight: Subcutaneous Tissue and Subdural Space / Intracranial Pressure Biotelemetry",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-681",
    sourceRetrievalTimestamp: "2026-08-28T05:27:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Rattus norvegicus",
      commonName: "Rat",
      strain: "Long-Evans / Sprague-Dawley",
      sex: "Male & Female",
      age: "Adult",
      sampleCount: 48,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-681",
      isVerified: true,
    },
    mission: {
      name: "Head-Down Tilt Bedrest / Hindlimb Unloading Rat Analog (LSDS-83)",
      platform: "Ground-based Analog",
      duration: "14 to 90 days head-down tilt (hindlimb unloading)",
      managingCenter: "NASA Ames Research Center / NASA Johnson Space Center",
      flightProgram: "NASA Human Research Program (HRP) / Ames Life Sciences Data Archive (ALSDA)",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-681",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Hindlimb Unloading / Head-Down Tilt", "Duration (14d, 30d, 90d)", "CO2 treatment", "Reloading recovery"],
      controls: ["Ground Vivarium Controls"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-681",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Subdural Space (Cerebrospinal Compartment)", "Subcutaneous Tissue"],
      anatomicalNotes: "Continuous invasive telemetric pressure sensors implanted in subdural space and subcutaneous tissue pockets.",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-681",
      isVerified: true,
    },
    assays: [
      {
        name: "Intracranial Pressure (ICP) & Core Body Temperature Biotelemetry",
        measurementType: "Continuous physiological pressure and temperature monitoring",
        technology: "Implantable Biotelemetry Transducers",
        platform: "Data Sciences International (DSI) Telemetry System",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-681",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Continuous Telemetric Monitoring of Intracranial Pressure During Cephalad Fluid Shift in Unsedated Rats",
        authors: "NASA ALSDA / HRP SANS Research Team",
        journal: "NASA Life Sciences Data Archive (LSDS-83)",
        year: 2022,
        url: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-681",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-681 (ALSDA LSDS-83) records continuous physiological intracranial pressure (ICP) and body temperature in rats via telemetry.",
      "Tissue / target site: Subdural space and subcutaneous telemetry pockets.",
      "OSD-681 is strictly a biotelemetric ICP pressure and temperature monitoring study.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Continuous telemetric measurements quantified a sustained elevation in intracranial pressure (ICP) during acute and chronic hindlimb unloading.",
        sourceCitation: "NASA ALSDA LSDS-83 Dataset",
        evidenceType: "observed_measurement",
      },
    ],
    unresolvedFields: [],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-681",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-681",
    },
  },

  "OSD-557": {
    accession: "OSD-557",
    canonicalTitle: "Spaceflight influences gene expression, photoreceptor integrity, and oxidative stress related damage in the murine retina (RR-9)",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
    sourceRetrievalTimestamp: "2026-11-09T07:00:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Male",
      age: "10 weeks at launch",
      sampleCount: 35,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
      isVerified: true,
    },
    mission: {
      name: "Rodent Research-9 (RR-9) / SpaceX-12",
      platform: "ISS",
      duration: "35 days on-orbit (08/14/2017 – 09/17/2017)",
      managingCenter: "NASA Ames Research Center",
      flightProgram: "International Space Station (ISS) / NASA Space Biology",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Space Flight (Microgravity, 35 days)"],
      controls: ["Ground Control", "Cohort Control 1 (CC1)", "Cohort Control 2 (CC2)"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Left eye", "Retina", "Photoreceptor layer"],
      anatomicalNotes: "35 left-eye ocular specimens from adult male C57BL/6J mice across Flight, Ground, CC1, and CC2 groups prepared for micro-CT morphometry and retinal immunostaining.",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
      isVerified: true,
    },
    assays: [
      {
        name: "Micro-Computed Tomography (Bone & Ocular Microstructure)",
        measurementType: "Bone Microstructure / Ocular Global Geometry",
        technology: "Micro-Computed Tomography",
        platform: "SkyScan_1272_desktop_micro-CT_system",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
        isVerified: true,
      },
      {
        name: "Retinal Histological Assay (Light Microscopy)",
        measurementType: "Histological Assay",
        technology: "Light Microscopy",
        platform: "Inverted fluorescence microscope",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
        isVerified: true,
      },
      {
        name: "4-HNE Oxidative Damage Immunostaining",
        measurementType: "Molecular Cellular Imaging",
        technology: "Immunostaining",
        platform: "4-HNE Lipid Peroxidation Assay / Fluorescence Microscopy",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
        isVerified: true,
      },
      {
        name: "PNA Cone Photoreceptor Immunostaining",
        measurementType: "Molecular Cellular Imaging",
        technology: "Immunostaining",
        platform: "Peanut Agglutinin (PNA) Lectin Staining / Fluorescence Microscopy",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Assessment of Global Ocular Structure Following Spaceflight Using a Micro-Computed Tomography (Micro-CT) Imaging Method",
        authors: "Roque-Torres GD, Nishiyama NC, Stanbouly S, Mao XW.",
        journal: "Journal of Visualized Experiments (JoVE)",
        year: 2020,
        doi: "10.3791/61227",
        pmid: "33191924",
        url: "https://doi.org/10.3791/61227",
        isPeerReviewed: true,
      },
      {
        title: "Spaceflight influences gene expression, photoreceptor integrity, and oxidative stress-related damage in the murine retina",
        authors: "Overbey EG, da Silveira WA, Stanbouly S, Nishiyama NC, Roque-Torres GD, Pecaut MJ, et al.",
        journal: "Scientific Reports",
        year: 2019,
        doi: "10.1038/s41598-019-49453-x",
        pmid: "31527661",
        url: "https://doi.org/10.1038/s41598-019-49453-x",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-557 holds the Micro-CT (SkyScan 1272), histological light microscopy, and 4-HNE/PNA immunostaining assays (35 left-eye samples) from RR-9 / SpaceX-12.",
      "OSD-557 does NOT contain RNA-seq sequencing files; the companion RR-9 right-retina Illumina RNA-seq dataset is deposited separately under OSD-255.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Micro-computed tomography (SkyScan 1272) quantified global 3D ocular geometry, axial dimensions, and scleral/lens structural metrics across flight and control mouse eyes.",
        sourceCitation: "Roque-Torres et al., JoVE (2020)",
        doi: "10.3791/61227",
        pmid: "33191924",
        evidenceType: "imaging",
      },
      {
        finding: "4-HNE and PNA immunostaining revealed increased retinal oxidative lipid peroxidation alongside photoreceptor cone structural vulnerability after 35 days of spaceflight.",
        sourceCitation: "Overbey et al., Sci Rep (2019)",
        doi: "10.1038/s41598-019-49453-x",
        pmid: "31527661",
        evidenceType: "histology",
      },
    ],
    unresolvedFields: [
      "Retinal RNA-seq sequencing data for this RR-9 investigation resides in OSD-255 (16 right-retina samples), not inside OSD-557 (Micro-CT & histology/immunostaining).",
    ],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-557",
      doi: "https://doi.org/10.3791/61227",
    },
    validationConstraints: {
      missionKey: "RR-9_SPACEX-12",
      cohortControls: ["Cohort Control 1 (CC1)", "Cohort Control 2 (CC2)", "Ground Control"],
      sampleSizeN: 35,
      animalDisjointRequired: true,
      batchNote: "RR-9 (SpaceX-12) 35 left-eye imaging/histology cohort containing CC1 and CC2 batch controls.",
    },
  },

  "OSD-194": {
    accession: "OSD-194",
    canonicalTitle: "Rodent Research-3-CASIS: Mouse retina transcriptomic data",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-194",
    sourceRetrievalTimestamp: "2026-08-28T05:27:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Female",
      age: "12 weeks at launch",
      sampleCount: 18,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-194",
      isVerified: true,
    },
    mission: {
      name: "Rodent Research-3 (CASIS) / SpaceX CRS-8",
      platform: "ISS",
      duration: "30 days on-orbit",
      managingCenter: "NASA Ames Research Center",
      flightProgram: "ISS National Laboratory / CASIS / NASA Space Biology",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-194",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Spaceflight (Microgravity, 30 days)", "Myostatin Inhibitor Treatment vs Vehicle"],
      controls: ["Ground Habitat Control", "Basal Control"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-194",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Retina"],
      anatomicalNotes: "Isolated neural retina tissue from female C57BL/6J mice.",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-194",
      isVerified: true,
    },
    assays: [
      {
        name: "RNA Sequencing (Transcriptomics)",
        measurementType: "Gene Expression (mRNA)",
        technology: "RNA Sequencing",
        platform: "Illumina HiSeq 2500",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-194",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Rodent Research-3 CASIS: Transcriptomic Profiling of Mouse Retina Following 30-Day Spaceflight",
        authors: "NASA GeneLab Consortium / Center for Advancement of Science in Space",
        journal: "NASA GeneLab Data System",
        year: 2018,
        doi: "10.26030/pev7-5695",
        url: "https://doi.org/10.26030/pev7-5695",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-194 contains RNA-seq transcriptomics of isolated mouse retina from the 30-day RR-3 CASIS ISS mission.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Retinal RNA-seq demonstrated transcriptional alterations in cell adhesion, extracellular matrix regulation, and vascular response genes following 30 days of spaceflight.",
        sourceCitation: "NASA GeneLab OSD-194 (DOI: 10.26030/pev7-5695)",
        doi: "10.26030/pev7-5695",
        evidenceType: "sequencing_expression",
      },
    ],
    unresolvedFields: [],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-194",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-194",
      doi: "https://doi.org/10.26030/pev7-5695",
    },
  },

  "OSD-87": {
    accession: "OSD-87",
    canonicalTitle: "Spaceflight effects on the mouse retina: Histological, gene expression and epigenetic changes after flight on STS-135",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87",
    sourceRetrievalTimestamp: "2026-08-28T05:27:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Female",
      age: "9 weeks at launch",
      sampleCount: 16,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87",
      isVerified: true,
    },
    mission: {
      name: "STS-135 (Space Shuttle Atlantis Final Flight) / Commercial Biomedical Testing Module (CBTM-3)",
      platform: "Space Shuttle",
      duration: "13 days on-orbit (harvested within 3-5h post-landing)",
      managingCenter: "NASA Ames Research Center",
      flightProgram: "NASA Space Life Sciences / Space Biology",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Spaceflight (Space Shuttle Orbit, 13 days)"],
      controls: ["Ground Animal Enclosure Module (AEM) Controls", "Vivarium Controls"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Retina", "Retinal Cryosections", "Choroid"],
      anatomicalNotes: "Retinal tissue and ocular sections harvested post-landing.",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87",
      isVerified: true,
    },
    assays: [
      {
        name: "Microarray Gene Expression Profiling",
        measurementType: "Gene Expression (mRNA)",
        technology: "DNA Microarray",
        platform: "Affymetrix GeneChip Mouse Genome 430 2.0 Array",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87",
        isVerified: true,
      },
      {
        name: "Retinal Histology & Apoptosis Staining",
        measurementType: "Histopathology & Photoreceptor quantification",
        technology: "H&E and TUNEL staining",
        platform: "Light and Fluorescence Microscopy",
        sourceUrl: "https://doi.org/10.1667/RR3309.1",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Spaceflight Environment Induces Mitochondrial Oxidative Damage in Ocular Tissue",
        authors: "Mao XW, Pecaut MJ, Stodieck LS, Ferguson VL, Bateman TA, Bouxsein ML, Jones TA, Moldovan M, Cunningham CE, Chieu J, Gridley DS",
        journal: "Radiation Research",
        year: 2013,
        doi: "10.1667/RR3309.1",
        pmid: "24033191",
        url: "https://doi.org/10.1667/RR3309.1",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-87 documents retinal histology and Affymetrix microarray gene expression from mice flown for 13 days on Space Shuttle mission STS-135.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Spaceflight induced significant upregulation of uncoupling protein 2 (Ucp2) and pro-apoptotic genes (caspase-3, Bax) alongside apoptotic loss of photoreceptors in the outer nuclear layer.",
        sourceCitation: "Mao et al., Radiat Res (2013)",
        doi: "10.1667/RR3309.1",
        pmid: "24033191",
        evidenceType: "histology",
      },
      {
        finding: "Demonstrated oxidative stress damage and photoreceptor cell death in murine retina even during relatively short (13-day) Space Shuttle flight.",
        sourceCitation: "Mao et al., Radiat Res (2013)",
        doi: "10.1667/RR3309.1",
        pmid: "24033191",
        evidenceType: "observed_measurement",
      },
    ],
    unresolvedFields: [],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-87",
      doi: "https://doi.org/10.1667/RR3309.1",
    },
  },

  "OSD-255": {
    accession: "OSD-255",
    canonicalTitle: "Spaceflight influences gene expression, photoreceptor integrity, and oxidative stress-related damage in the murine retina",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-255",
    sourceRetrievalTimestamp: "2026-11-09T07:00:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Male",
      age: "10 weeks at launch",
      sampleCount: 16,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-255",
      isVerified: true,
    },
    mission: {
      name: "Rodent Research-9 (RR-9) / SpaceX-12",
      platform: "ISS",
      duration: "35 days on-orbit (08/14/2017 – 09/17/2017)",
      managingCenter: "NASA Ames Research Center",
      flightProgram: "International Space Station (ISS) / NASA Space Biology",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-255",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Space Flight (Microgravity, 35 days)"],
      controls: ["Ground Control", "RR-9 Cohort Context (CC1/CC2)"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-255",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Right retina", "Retina", "Photoreceptor layer"],
      anatomicalNotes: "16 right-retina RNA-seq samples from distinct male C57BL/6J mice (8 Space Flight, 8 Ground Control; GEO GSE131954). Left eyes from RR-9 were routed to imaging/histology (OSD-557).",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-255",
      isVerified: true,
    },
    assays: [
      {
        name: "RNA Sequencing (RNA-Seq Transcriptomics)",
        measurementType: "transcription profiling",
        technology: "RNA Sequencing (RNA-Seq)",
        platform: "Illumina (GSE131954)",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-255",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Spaceflight influences gene expression, photoreceptor integrity, and oxidative stress-related damage in the murine retina.",
        authors: "Overbey EG, da Silveira WA, Stanbouly S, Nishiyama NC, Roque-Torres GD, Pecaut MJ, Zawieja DC, Wang C, Willey JS, Delp MD, Hardiman G, Mao XW.",
        journal: "Scientific Reports",
        year: 2019,
        doi: "10.1038/s41598-019-49453-x",
        pmid: "31527661",
        url: "https://doi.org/10.1038/s41598-019-49453-x",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-255 (GLDS-255 / GSE131954) is the verified RR-9 retinal RNA-seq dataset (n=16 right-retina samples: 8 Space Flight, 8 Ground Control).",
      "Extreme p >> n constraint (16 animals vs thousands of transcripts) requires animal-disjoint cross-validation and inner-fold feature selection.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Retinal RNA-seq (n=16 right retinas) revealed 600 differentially expressed genes enriched for visual perception, phototransduction, photoreceptor cell maintenance, oxidative stress response, and mitochondrial apoptosis pathways after 35-day ISS flight.",
        sourceCitation: "Overbey et al., Sci Rep (2019)",
        doi: "10.1038/s41598-019-49453-x",
        pmid: "31527661",
        evidenceType: "sequencing_expression",
      },
    ],
    unresolvedFields: [],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-255",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-255",
      doi: "https://doi.org/10.1038/s41598-019-49453-x",
    },
    validationConstraints: {
      missionKey: "RR-9_SPACEX-12",
      cohortControls: ["Ground Control", "RR-9 Cohort Context (CC1/CC2)"],
      sampleSizeN: 16,
      animalDisjointRequired: true,
      batchNote: "Severe p >> n bottleneck (n=16 animals: 8 Flight, 8 Ground); requires strictly animal-disjoint outer CV folds, inner-fold scaling/selection, and RR-9 CC1/CC2 awareness.",
    },
  },

  "OSD-685": {
    accession: "OSD-685",
    canonicalTitle: "Spaceflight-Induced Gene Expression Profiles in the Mouse Brain Are Attenuated by Treatment with the Antioxidant BuOE - Dentate Gyrus",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-685",
    sourceRetrievalTimestamp: "2026-11-09T07:00:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Male",
      age: "10 weeks at launch",
      sampleCount: 12,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-685",
      isVerified: true,
    },
    mission: {
      name: "Rodent Research-18 (RR-18) / SpaceX-24",
      platform: "ISS",
      duration: "34 days on-orbit (12/21/2021 – 01/24/2022)",
      managingCenter: "NASA Ames Research Center",
      flightProgram: "International Space Station (ISS) / NASA Space Biology",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-685",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Spaceflight", "Treatment: Antioxidant BuOE vs. Saline"],
      controls: ["Saline Treated Ground Control", "BuOE Treated Ground Control"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-685",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Brain", "Dentate Gyrus"],
      anatomicalNotes: "Mouse hippocampal Dentate Gyrus regions of interest (12 samples; GEO GSE239336) profiled on SpaceX-24 (RR-18), with zero shared animals with RR-9 / SpaceX-12 (e.g., OSD-255).",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-685",
      isVerified: true,
    },
    assays: [
      {
        name: "Spatial Transcriptomics (Nanostring GeoMx DSP)",
        measurementType: "transcription profiling",
        technology: "spatial transcriptomics",
        platform: "Nanostring GeoMx digital spatial profiling (DSP) platform",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-685",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Spaceflight-Induced Gene Expression Profiles in the Mouse Brain Are Attenuated by Treatment with the Antioxidant BuOE.",
        authors: "Kremsky I, Ali S, Stanbouly S, Holley J, Justinen S, Pecaut M, Crapo J, Mao X.",
        journal: "International Journal of Molecular Sciences",
        year: 2023,
        doi: "10.3390/ijms241713569",
        pmid: "37686374",
        url: "https://doi.org/10.3390/ijms241713569",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-685 profiles mouse brain Dentate Gyrus spatial transcriptomics (Nanostring GeoMx DSP, n=12) from ISS SpaceX-24 (RR-18).",
      "Originates from a separate mission (SpaceX-24) than RR-9 / SpaceX-12 (OSD-255, OSD-557, OSD-583) with zero shared animal subjects.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Nanostring GeoMx digital spatial profiling of the Dentate Gyrus demonstrated spaceflight-induced transcriptional alterations in metabolic, neuroinflammatory, and oxidative stress pathways that were attenuated by metalloporphyrin antioxidant BuOE treatment.",
        sourceCitation: "Kremsky et al., IJMS (2023)",
        doi: "10.3390/ijms241713569",
        pmid: "37686374",
        evidenceType: "sequencing_expression",
      },
    ],
    unresolvedFields: [
      "Originates from brain Dentate Gyrus on SpaceX-24 (RR-18), NOT retina; zero shared animal subjects with RR-9 (OSD-255).",
    ],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-685",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-685",
      doi: "https://doi.org/10.3390/ijms241713569",
    },
    validationConstraints: {
      missionKey: "RR-18_SPACEX-24",
      cohortControls: ["Saline Treated Ground Control", "BuOE Treated"],
      sampleSizeN: 12,
      animalDisjointRequired: true,
      spatialAlignmentRequired: true,
      batchNote: "SpaceX-24 (RR-18) GeoMx spatial slice ROIs (n=12); zero shared animals with RR-9 and requires spatial coordinate / ROI alignment before cross-study modeling.",
    },
  },

  "OSD-698": {
    accession: "OSD-698",
    canonicalTitle: "Spaceflight-Induced Gene Expression Profiles in the Mouse Brain Are Attenuated by Treatment with the Antioxidant BuOE - Frontal Cortex",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-698",
    sourceRetrievalTimestamp: "2026-11-09T07:00:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Male",
      age: "10 weeks at launch",
      sampleCount: 12,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-698",
      isVerified: true,
    },
    mission: {
      name: "Rodent Research-18 (RR-18) / SpaceX-24",
      platform: "ISS",
      duration: "34 days on-orbit (12/21/2021 – 01/24/2022)",
      managingCenter: "NASA Ames Research Center",
      flightProgram: "International Space Station (ISS) / NASA Space Biology",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-698",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Spaceflight", "Treatment: Antioxidant BuOE vs. Saline"],
      controls: ["Saline Treated Ground Control", "BuOE Treated Ground Control"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-698",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Brain", "Frontal Cortex"],
      anatomicalNotes: "Mouse Frontal Cortex regions of interest (12 samples; GEO GSE239336) profiled on SpaceX-24 (RR-18) alongside OSD-685, with zero shared animals with RR-9 / SpaceX-12 (OSD-255).",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-698",
      isVerified: true,
    },
    assays: [
      {
        name: "Spatial Transcriptomics (Nanostring GeoMx DSP)",
        measurementType: "transcription profiling",
        technology: "spatial transcriptomics",
        platform: "Nanostring GeoMx digital spatial profiling (DSP) platform",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-698",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Spaceflight-Induced Gene Expression Profiles in the Mouse Brain Are Attenuated by Treatment with the Antioxidant BuOE.",
        authors: "Kremsky I, Ali S, Stanbouly S, Holley J, Justinen S, Pecaut M, Crapo J, Mao X.",
        journal: "International Journal of Molecular Sciences",
        year: 2023,
        doi: "10.3390/ijms241713569",
        pmid: "37686374",
        url: "https://doi.org/10.3390/ijms241713569",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-698 profiles mouse brain Frontal Cortex spatial transcriptomics (Nanostring GeoMx DSP, n=12) from ISS SpaceX-24 (RR-18).",
      "Shares the SpaceX-24 mission cohort with OSD-685, and has zero shared animal subjects with RR-9 / SpaceX-12 (OSD-255).",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "GeoMx spatial profiling in the Frontal Cortex identified region-specific spaceflight expression shifts and BuOE-mediated mitigation of stress-response gene networks.",
        sourceCitation: "Kremsky et al., IJMS (2023)",
        doi: "10.3390/ijms241713569",
        pmid: "37686374",
        evidenceType: "sequencing_expression",
      },
    ],
    unresolvedFields: [
      "Originates from brain Frontal Cortex on SpaceX-24 (RR-18), NOT retina; zero shared animal subjects with RR-9 (OSD-255).",
    ],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-698",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-698",
      doi: "https://doi.org/10.3390/ijms241713569",
    },
    validationConstraints: {
      missionKey: "RR-18_SPACEX-24",
      cohortControls: ["Saline Treated Ground Control", "BuOE Treated"],
      sampleSizeN: 12,
      animalDisjointRequired: true,
      spatialAlignmentRequired: true,
      batchNote: "SpaceX-24 (RR-18) GeoMx spatial slice ROIs (n=12); shares SpaceX-24 cohort with OSD-685, zero shared animals with RR-9, and requires spatial ROI alignment.",
    },
  },

  "OSD-758": {
    accession: "OSD-758",
    canonicalTitle: "Artificial Gravity Attenuates the Transcriptomic Response to Spaceflight in the Optic Nerve and Retina -- Retina data",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-758",
    sourceRetrievalTimestamp: "2026-11-10T00:00:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Male",
      sampleCount: 35,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-758",
      isVerified: true,
    },
    mission: {
      name: "Mouse Habitat Unit-8 (MHU-8) / SpaceX CRS-27",
      platform: "ISS",
      duration: "~32 days on-orbit (03/14/2023 – 04/15/2023)",
      managingCenter: "NASA Ames Research Center / JAXA MHU-8",
      flightProgram: "International Space Station (ISS) / NASA HRP Grant 80NSSC18K0310",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-758",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Spaceflight Microgravity (µg / 0g)", "Artificial Gravity Centrifugation (0.33g, 0.67g [~0.66G], 1.0g)"],
      controls: ["Habitat Ground Control", "In-Flight 1.0g Centrifuge Reference"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-758",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Retina"],
      anatomicalNotes: "35 retinal RNA-seq samples (MHU-8_RTN_*) across microgravity (0g/µg), partial artificial gravity (0.33g, 0.67g), 1.0g centrifuge, and ground habitat controls on SpaceX CRS-27.",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-758",
      isVerified: true,
    },
    assays: [
      {
        name: "RNA Sequencing (RNA-Seq Transcriptomics)",
        measurementType: "transcription profiling",
        technology: "RNA Sequencing (RNA-Seq)",
        platform: "Illumina NovaSeq 6000 (151bp paired-end)",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-758",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Artificial Gravity Attenuates the Transcriptomic Response to Spaceflight in the Optic Nerve and Retina",
        authors: "Kremsky I, Pergerson R, Justinen S, Stanbouly S, Willey J, Fuller CA, Takahashi S, Vitaterna MH, Bouxsein M, Mao X",
        journal: "International Journal of Molecular Sciences",
        year: 2024,
        doi: "10.3390/ijms252212041",
        pmid: "39596110",
        url: "https://doi.org/10.3390/ijms252212041",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-758 contains 35 murine retina RNA-seq samples from ISS MHU-8 / SpaceX-27 (released 2024-11-06, OSDR DOI: 10.26030/d6dj-d777).",
      "Tests graded artificial gravity centrifugation (0g/µg, 0.33g, 0.67g [0.66G], and 1.0g) vs. ground controls.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Microgravity altered retinal transcription in oxidative stress, inflammation, apoptosis, and lipid metabolism pathways, while onboard centrifugation (0.33g, 0.67g, 1.0g) dose-dependently attenuated spaceflight-induced transcriptomic dysregulation.",
        sourceCitation: "Kremsky et al., IJMS (2024)",
        doi: "10.3390/ijms252212041",
        pmid: "39596110",
        evidenceType: "sequencing_expression",
      },
    ],
    unresolvedFields: [
      "Separate SpaceX-27 mission cohort from RR-9 / SpaceX-12 (OSD-255): zero shared animals; cross-mission replication requires frozen discovery panels (e.g., OSD-255 NASA FDR < 0.05 genes evaluated out-of-sample across MHU-8 gravity bins).",
    ],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-758",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-758",
      doi: "https://doi.org/10.3390/ijms252212041",
    },
    validationConstraints: {
      missionKey: "ISS_MHU-8",
      cohortControls: ["Habitat Ground Control", "0g (µg) Flight", "0.33g Centrifuge", "0.67g Centrifuge", "1.0g Centrifuge"],
      sampleSizeN: 35,
      animalDisjointRequired: true,
      batchNote: "MHU-8 / SpaceX CRS-27 multi-gravity cohort (n=35 retina samples). Independent mission from RR-9 (OSD-255); suitable for frozen-panel external validation without re-fitting FDR thresholds on combined cohorts.",
    },
  },

  "OSD-759": {
    accession: "OSD-759",
    canonicalTitle: "Artificial Gravity Attenuates the Transcriptomic Response to Spaceflight in the Optic Nerve and Retina -- Optic nerve data",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-759",
    sourceRetrievalTimestamp: "2026-11-10T00:00:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Male",
      sampleCount: 35,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-759",
      isVerified: true,
    },
    mission: {
      name: "Mouse Habitat Unit-8 (MHU-8) / SpaceX CRS-27",
      platform: "ISS",
      duration: "~32 days on-orbit (03/14/2023 – 04/15/2023)",
      managingCenter: "NASA Ames Research Center / JAXA MHU-8",
      flightProgram: "International Space Station (ISS) / NASA HRP Grant 80NSSC18K0310",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-759",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Spaceflight Microgravity (µg / 0g)", "Artificial Gravity Centrifugation (0.33g, 0.67g, 1.0g)"],
      controls: ["Habitat Ground Control", "In-Flight 1.0g Centrifuge Reference"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-759",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Optic Nerve"],
      anatomicalNotes: "35 paired optic nerve RNA-seq samples (MHU-8_ON_*) collected alongside OSD-758 retina samples during ISS MHU-8 / SpaceX CRS-27.",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-759",
      isVerified: true,
    },
    assays: [
      {
        name: "RNA Sequencing (RNA-Seq Transcriptomics)",
        measurementType: "transcription profiling",
        technology: "RNA Sequencing (RNA-Seq)",
        platform: "Illumina NovaSeq 6000 (151bp paired-end)",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-759",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Artificial Gravity Attenuates the Transcriptomic Response to Spaceflight in the Optic Nerve and Retina",
        authors: "Kremsky I, Pergerson R, Justinen S, Stanbouly S, Willey J, Fuller CA, Takahashi S, Vitaterna MH, Bouxsein M, Mao X",
        journal: "International Journal of Molecular Sciences",
        year: 2024,
        doi: "10.3390/ijms252212041",
        pmid: "39596110",
        url: "https://doi.org/10.3390/ijms252212041",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-759 contains 35 murine optic nerve RNA-seq samples from ISS MHU-8 / SpaceX-27 (released 2024-11-06, OSDR DOI: 10.26030/52fc-ph93).",
      "Companion optic-nerve tissue arm to OSD-758 (retina) from the same MHU-8 spaceflight cohort.",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Optic nerve transcriptomes showed robust spaceflight stress and inflammatory activation that was attenuated in a gravity-level-dependent manner across 0.33g, 0.67g, and 1.0g centrifuge groups.",
        sourceCitation: "Kremsky et al., IJMS (2024)",
        doi: "10.3390/ijms252212041",
        pmid: "39596110",
        evidenceType: "sequencing_expression",
      },
    ],
    unresolvedFields: [
      "Companion tissue arm from the same MHU-8 animals as OSD-758 (retina); treat tissue comparisons as paired within-mission tissues rather than independent animal replicates.",
    ],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-759",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-759",
      doi: "https://doi.org/10.3390/ijms252212041",
    },
    validationConstraints: {
      missionKey: "ISS_MHU-8",
      cohortControls: ["Habitat Ground Control", "0g (µg) Flight", "0.33g Centrifuge", "0.67g Centrifuge", "1.0g Centrifuge"],
      sampleSizeN: 35,
      animalDisjointRequired: true,
      batchNote: "Shares MHU-8 / SpaceX CRS-27 cohort animals with OSD-758 (Optic Nerve vs. Retina); account for matched animal IDs.",
    },
  },

  "OSD-203": {
    accession: "OSD-203",
    canonicalTitle: "Low dose (0.04 Gy) irradiation (LDR) and hindlimb unloading (HLU) microgravity in mice: retina transcriptomic and epigenomic data",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-203",
    sourceRetrievalTimestamp: "2026-11-10T00:00:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Female",
      age: "6 months at start",
      sampleCount: 59,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-203",
      isVerified: true,
    },
    mission: {
      name: "Ground Analog: Hindlimb Unloading (HLU, 21d) + Low-Dose Irradiation (0.04 Gy 57Co Gamma)",
      platform: "Ground-based Analog",
      duration: "21 days exposure + 7d, 1mo, 4mo longitudinal recovery harvest",
      managingCenter: "NASA Ames Research Center / LSDA Experiment 13471",
      flightProgram: "NASA Space Radiation & Space Biology (NNX13AL97G, 80NSSC17K0693)",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-203",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Hindlimb Unloading (HLU)", "Low-Dose Ionizing Radiation (0.04 Gy 57Co)", "Post-Exposure Timepoint (7d, 1mo, 4mo)"],
      controls: ["Unexposed Sham Control", "Single-Factor HLU Control", "Single-Factor LDR Control"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-203",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Retina"],
      anatomicalNotes: "59 mature 6-month-old female C57BL/6J mouse retina samples (OSDR DOI: 10.26030/jphn-pj10) spanning 7 days, 1 month, and 4 months post-exposure.",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-203",
      isVerified: true,
    },
    assays: [
      {
        name: "RNA Sequencing (RNA-Seq Transcriptomics)",
        measurementType: "transcription profiling",
        technology: "RNA Sequencing (RNA-Seq)",
        platform: "Illumina HiSeq 4000",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-203",
        isVerified: true,
      },
      {
        name: "Reduced-Representation Bisulfite Sequencing (RRBS)",
        measurementType: "DNA methylation profiling",
        technology: "Reduced-Representation Bisulfite Sequencing",
        platform: "Illumina",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-203",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "A multi-omics longitudinal study of the murine retinal response to chronic low-dose irradiation and simulated microgravity",
        authors: "Kothiyal P, Eley G, Ilangovan H, Hoadley KA, Elgart SR, Mao XW, Eslami P",
        journal: "Scientific Reports",
        year: 2022,
        doi: "10.1038/s41598-022-19360-9",
        pmid: "36207342",
        url: "https://doi.org/10.1038/s41598-022-19360-9",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-203 (GLDS-203; OSDR DOI: 10.26030/jphn-pj10) profiles 59 mouse retina samples under ground 21-day HLU + 0.04 Gy LDR across 7d, 1mo, and 4mo post-exposure.",
      "Assays recorded on OSDR are RNA-Seq and Reduced-Representation Bisulfite Sequencing (RRBS).",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Longitudinal multi-omics identified thousands of differentially methylated loci/regions and time-dependent transcriptomic shifts across nucleotide metabolism, inflammation, Notch, and Wnt signaling pathways up to 4 months post-HLU+LDR exposure.",
        sourceCitation: "Kothiyal et al., Sci Rep (2022)",
        doi: "10.1038/s41598-022-19360-9",
        pmid: "36207342",
        evidenceType: "sequencing_expression",
      },
    ],
    unresolvedFields: [
      "Ground analog using 6-month-old female mice with radiation + unloading factorial arms (different sex, age, and terrestrial radiation spectrum vs. male RR-9 spaceflight cohort OSD-255).",
    ],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-203",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-203",
      doi: "https://doi.org/10.1038/s41598-022-19360-9",
    },
    validationConstraints: {
      missionKey: "GRD_HLU_LDR_203",
      cohortControls: ["Unexposed Control", "HLU-Only", "0.04 Gy LDR-Only", "7d / 1mo / 4mo Recovery Timepoints"],
      sampleSizeN: 59,
      animalDisjointRequired: true,
      batchNote: "Ground analog factorial HLU + 0.04 Gy LDR longitudinal cohort (n=59, female 6-mo C57BL/6J); stratify by post-exposure timepoint (7d/1mo/4mo) and radiation/unloading arm.",
    },
  },

  "OSD-568": {
    accession: "OSD-568",
    canonicalTitle: "Characterization of mouse ocular responses (Microscopy) to a 35-day (RR-9) spaceflight mission: Evidence of blood-retinal barrier disruption and ocular adaptations",
    osdrRecordUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-568",
    sourceRetrievalTimestamp: "2026-11-10T00:00:00Z",
    confidence: "verified",
    organism: {
      scientificName: "Mus musculus",
      commonName: "Mouse",
      strain: "C57BL/6J",
      sex: "Male",
      age: "10 weeks at launch",
      sampleCount: 23,
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-568",
      isVerified: true,
    },
    mission: {
      name: "Rodent Research-9 (RR-9) / SpaceX-12",
      platform: "ISS",
      duration: "35 days on-orbit (08/14/2017 – 09/17/2017; splashdown tissue harvest ~38±4h)",
      managingCenter: "NASA Ames Research Center",
      flightProgram: "ISS / NASA Space Biology",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-568",
      isVerified: true,
    },
    experimentalGroups: {
      factors: ["Spaceflight (Microgravity, 35 days)"],
      controls: ["Ground Habitat Control", "Vivarium Control", "Cohort Control 2 (CC2)"],
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-568",
      isVerified: true,
    },
    tissueMaterial: {
      exactScope: ["Whole Eye", "Retina", "Retinal microvasculature"],
      anatomicalNotes: "23 fluorescence microscopy ocular specimens (OSDR DOI: 10.26030/d09k-4e68) quantifying retinal TUNEL apoptosis and endothelial/tight-junction markers (PECAM-1, ZO-1).",
      sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-568",
      isVerified: true,
    },
    assays: [
      {
        name: "Fluorescence Microscopy — Apoptosis & Blood-Retinal Barrier Markers (TUNEL, PECAM-1, ZO-1)",
        measurementType: "Molecular Cellular Imaging",
        technology: "Microscopy",
        platform: "Keyence BZ-X710 / BZ-X700 Fluorescence Microscopy",
        sourceUrl: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-568",
        isVerified: true,
      },
    ],
    linkedPublications: [
      {
        title: "Characterization of mouse ocular response to a 35-day spaceflight mission: Evidence of blood-retinal barrier disruption and ocular adaptations",
        authors: "Mao XW, Nishiyama NC, Byrum SD, Stanbouly S, Jones T, Drew A, Sridharan V, Boerma M, Tackett AJ, Zawieja D, Willey JS, Delp M, Pecaut MJ",
        journal: "Scientific Reports",
        year: 2019,
        doi: "10.1038/s41598-019-44696-0",
        pmid: "31160660",
        url: "https://doi.org/10.1038/s41598-019-44696-0",
        isPeerReviewed: true,
      },
    ],
    directMetadataStatements: [
      "OSD-568 holds 23 RR-9 / SpaceX-12 Keyence fluorescence microscopy datasets (released 2023-05-30, OSDR DOI: 10.26030/d09k-4e68).",
      "Does not duplicate RNA-seq (OSD-255) or Micro-CT/4-HNE/PNA assays (OSD-557).",
    ],
    directPublicationSupportedFindings: [
      {
        finding: "Spaceflight increased TUNEL-positive apoptotic endothelial cells and PECAM-1 immunoreactivity while reducing tight-junction protein ZO-1 expression in murine retinal vasculature, evidencing blood-retinal barrier (BRB) disruption.",
        sourceCitation: "Mao et al., Sci Rep (2019)",
        doi: "10.1038/s41598-019-44696-0",
        pmid: "31160660",
        evidenceType: "histology",
      },
    ],
    unresolvedFields: [
      "Microscopy sub-cohort (n=23) shares the RR-9 / SpaceX-12 mission background and CC2 controls; do not pool unadjusted summary effect sizes with OSD-557 (4-HNE/PNA/Micro-CT) without accounting for shared mission provenance.",
    ],
    fieldSources: {
      organism: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-568",
      assays: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-568",
      doi: "https://doi.org/10.1038/s41598-019-44696-0",
    },
    validationConstraints: {
      missionKey: "RR-9_SPACEX-12",
      cohortControls: ["Ground Control", "Vivarium Control", "Cohort Control 2 (CC2)"],
      sampleSizeN: 23,
      animalDisjointRequired: true,
      batchNote: "RR-9 / SpaceX-12 fluorescence microscopy dataset (n=23; TUNEL, PECAM-1, ZO-1) alongside CC2 cohort controls; distinct from OSD-557 (4-HNE/PNA/Micro-CT) and OSD-255 (RNA-seq).",
    },
  },
};

/**
 * Retrieves the authoritative StudyManifest for an accession
 */
export function getStudyManifest(accession: string): StudyManifest | null {
  const norm = accession.toUpperCase().startsWith("OSD-")
    ? accession.toUpperCase()
    : `OSD-${accession.toUpperCase()}`;
  return CANONICAL_STUDY_MANIFESTS[norm] || null;
}

/**
 * Returns all canonical study manifests
 */
export function getAllStudyManifests(): StudyManifest[] {
  return Object.values(CANONICAL_STUDY_MANIFESTS);
}
