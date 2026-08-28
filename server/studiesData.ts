export interface OSDRStudy {
  study_id: string;
  title: string;
  description: string;
  organism: string;
  material_type: string;
  assay_measurement: string;
  assay_platform: string;
  assay_technology: string;
  study_factor: string;
  mission: string;
  flight_program: string;
  publication_title: string;
  publication_authors: string;
  managing_center: string;
  release_date: string;
  file_count: number;
  doi?: string;
  pmid?: string;
  data_quality?: "verified" | "partially_verified" | "unresolved";
  files?: Array<{ file_name?: string; category?: string; file_size?: number }>;
  fetched_at?: string;
  source_type?: "static_seeded_example" | "live_api" | "cached_snapshot" | "local_curated_mapping";
}

export const INITIAL_STUDIES: OSDRStudy[] = [
  {
    study_id: "OSD-583",
    title: "Characterization of mouse ocular responses (intraocular pressure) to a 35-day (RR-9) spaceflight mission: Evidence of blood-retinal barrier disruption and ocular adaptations",
    description: "Rodent Research-9 (RR-9) spaceflight study aboard ISS. Investigated intraocular pressure (IOP) via rebound tonometry and retinal histopathology/immunohistochemistry (TUNEL, AQP-4) in male C57BL/6 mice after 35 days in spaceflight, demonstrating lower post-flight IOP, retinal apoptosis, and blood-retinal barrier alteration.",
    organism: "Mus musculus (Mouse, C57BL/6J male)",
    material_type: "Whole Eye, Retina, Retinal microvasculature",
    assay_measurement: "Intraocular Pressure (IOP) & Retinal Histology/Immunofluorescence",
    assay_platform: "TonoLab Tonometer & Confocal Microscopy",
    assay_technology: "Rebound Tonometry & Immunohistochemistry",
    study_factor: "Spaceflight (35 days, Microgravity vs. Ground Control)",
    mission: "ISS Rodent Research-9 (RR-9)",
    flight_program: "NASA Space Biology",
    publication_title: "Characterization of mouse ocular responses (intraocular pressure) to a 35-day (RR-9) spaceflight mission: Evidence of blood-retinal barrier disruption and ocular adaptations",
    publication_authors: "Mao XW, Nishiyama NC, Pecaut MJ, et al., 2019",
    managing_center: "NASA Ames Research Center",
    release_date: "2019-06-03",
    doi: "10.1038/s41598-019-44696-0",
    pmid: "31160677",
    data_quality: "verified",
    file_count: 42,
    files: [
      { file_name: "OSD-583_IOP_measurements.csv", category: "Physiological Data", file_size: 150000 },
      { file_name: "OSD-583_histology_protocols.pdf", category: "Documentation", file_size: 450000 }
    ]
  },
  {
    study_id: "OSD-100",
    title: "Rodent Research-1 (RR1) NASA Validation Flight: Mouse eye transcriptomic and epigenomic data",
    description: "Multi-tissue transcriptomic and epigenomic analysis from female C57BL/6 mice flown on the ISS for 37 days during the Rodent Research-1 validation flight. Contains RNA-seq and bisulfite sequencing from whole eye globes.",
    organism: "Mus musculus (Mouse, C57BL/6J female)",
    material_type: "Whole Eye Globe",
    assay_measurement: "RNA-seq (Transcriptomics) & Bisulfite Sequencing (DNA Methylation)",
    assay_platform: "Illumina NextSeq 500",
    assay_technology: "RNA-seq & Whole Genome/Targeted Bisulfite Sequencing",
    study_factor: "Spaceflight (37 days, Microgravity vs. Ground Control)",
    mission: "ISS Rodent Research-1 (RR-1)",
    flight_program: "NASA Space Biology / GeneLab",
    publication_title: "NASA Rodent Research-1 Validation Flight: Multi-tissue transcriptomics and epigenomics in spaceflight",
    publication_authors: "NASA GeneLab Consortium, 2017",
    managing_center: "NASA Ames Research Center",
    release_date: "2017-08-01",
    doi: "10.26030/whek-4p98",
    data_quality: "verified",
    file_count: 54,
    files: [
      { file_name: "OSD-100_rna_counts.csv", category: "Processed Data", file_size: 6200000 },
      { file_name: "OSD-100_methylation_calls.bed", category: "Processed Data", file_size: 14000000 }
    ]
  },
  {
    study_id: "OSD-679",
    title: "Head-down tilt as a model for intracranial and intraocular pressures and retinal changes during spaceflight: Eye / Ophthalmic Diagnostic Imaging",
    description: "Ground-based rodent SANS analog study (ALSDA LSDS-81) in rats subjected to head-down tilt (hindlimb unloading) to simulate cephalad fluid shift. Utilizes non-invasive in vivo ophthalmic diagnostic techniques: optical coherence tomography (OCT), rebound tonometry (IOP), A-scan ultrasound, and MRI.",
    organism: "Rattus norvegicus (Rat)",
    material_type: "Eye, Retina, Anterior Segment, Cornea",
    assay_measurement: "Optical Coherence Tomography (OCT), IOP Tonometry, A-Scan Ultrasound, MRI",
    assay_platform: "Bioptigen Spectral Domain OCT & TonoLab",
    assay_technology: "In Vivo Ophthalmic Diagnostic Imaging & Tonometry",
    study_factor: "Head-Down Tilt Hindlimb Unloading (14-90 days), CO2 Treatment, Reloading",
    mission: "Ground-based SANS Analog (LSDS-81)",
    flight_program: "NASA Human Research Program (HRP) / ALSDA",
    publication_title: "Development of a Rodent Model for Spaceflight-Associated Neuro-ocular Syndrome (SANS): Retinal and Ocular Changes Under Cephalad Fluid Shift",
    publication_authors: "NASA ALSDA / HRP SANS Research Team, 2022",
    managing_center: "NASA Ames Research Center / JSC",
    release_date: "2022-04-15",
    data_quality: "verified",
    file_count: 36,
    files: [
      { file_name: "OSD-679_OCT_thickness_measurements.csv", category: "Diagnostic Data", file_size: 3200000 },
      { file_name: "OSD-679_IOP_longitudinal.csv", category: "Diagnostic Data", file_size: 890000 }
    ]
  },
  {
    study_id: "OSD-680",
    title: "Head-down tilt as a model for intracranial and intraocular pressures and retinal changes during spaceflight: Optic Nerve / Magnetic Resonance Imaging",
    description: "Ground-based rodent SANS analog study (ALSDA LSDS-82) evaluating the optic nerve in rats under head-down tilt hindlimb unloading. Utilizes high-resolution in vivo Magnetic Resonance Imaging (MRI) to measure optic nerve diameter, sheath distension, optic nerve head swelling, and optic globe distances.",
    organism: "Rattus norvegicus (Rat)",
    material_type: "Optic Nerve, Optic Nerve Sheath, Retrobulbar Space",
    assay_measurement: "Magnetic Resonance Imaging (MRI) - Optic Nerve Morphometry",
    assay_platform: "Small Animal High-Field MRI Scanner",
    assay_technology: "Magnetic Resonance Imaging",
    study_factor: "Head-Down Tilt Hindlimb Unloading (14-90 days), CO2 Treatment, Reloading",
    mission: "Ground-based SANS Analog (LSDS-82)",
    flight_program: "NASA Human Research Program (HRP) / ALSDA",
    publication_title: "MRI Quantification of Optic Nerve Sheath Diameter and Optic Nerve Head Swelling in a Rodent SANS Analog",
    publication_authors: "NASA ALSDA / HRP SANS Research Team, 2022",
    managing_center: "NASA Ames Research Center / JSC",
    release_date: "2022-06-20",
    data_quality: "verified",
    file_count: 24,
    files: [
      { file_name: "OSD-680_MRI_optic_nerve_measurements.csv", category: "Processed Data", file_size: 4500000 }
    ]
  },
  {
    study_id: "OSD-681",
    title: "Head-down tilt as a model for intracranial and intraocular pressures and retinal changes during spaceflight: Subcutaneous Tissue and Subdural Space / Intracranial Pressure Biotelemetry",
    description: "Ground-based rodent SANS analog study (ALSDA LSDS-83) in rats under head-down tilt hindlimb unloading. Measures continuous intracranial pressure (ICP) and core body temperature via implantable biotelemetry sensors in the subdural space and subcutaneous tissue pockets.",
    organism: "Rattus norvegicus (Rat)",
    material_type: "Subdural Space (CSF Compartment), Subcutaneous Tissue",
    assay_measurement: "Intracranial Pressure (ICP) & Temperature Biotelemetry",
    assay_platform: "DSI Implantable Telemetry System",
    assay_technology: "Continuous Invasive Physiological Biotelemetry",
    study_factor: "Head-Down Tilt Hindlimb Unloading (14-90 days), CO2 Treatment, Reloading",
    mission: "Ground-based SANS Analog (LSDS-83)",
    flight_program: "NASA Human Research Program (HRP) / ALSDA",
    publication_title: "Continuous Telemetric Monitoring of Intracranial Pressure During Cephalad Fluid Shift in Unsedated Rats",
    publication_authors: "NASA ALSDA / HRP SANS Research Team, 2022",
    managing_center: "NASA Ames Research Center / JSC",
    release_date: "2022-08-10",
    data_quality: "verified",
    file_count: 18
  },
  {
    study_id: "OSD-557",
    title: "Spaceflight influences gene expression, photoreceptor integrity, and oxidative stress related damage in the murine retina (RR-9) Study",
    description: "Transcriptomic sequencing of isolated neural retina from male C57BL/6 mice flown on the ISS for 35 days during the Rodent Research-9 (RR-9) mission. Evaluates gene expression dysregulation in mitochondrial oxidative phosphorylation, apoptotic signaling (caspases), and phototransduction.",
    organism: "Mus musculus (Mouse, C57BL/6J male)",
    material_type: "Retina, Photoreceptor layer",
    assay_measurement: "RNA-seq (Transcriptomics)",
    assay_platform: "Illumina HiSeq 4000",
    assay_technology: "RNA Sequencing",
    study_factor: "Spaceflight (35 days, Microgravity vs. Ground Control)",
    mission: "ISS Rodent Research-9 (RR-9)",
    flight_program: "NASA Space Biology",
    publication_title: "Spaceflight influences gene expression, photoreceptor integrity, and oxidative stress-related damage in the murine retina",
    publication_authors: "Mao XW, Pecaut MJ, Stodieck LS, Ferguson VL, et al., 2020",
    managing_center: "NASA Ames Research Center",
    release_date: "2020-04-14",
    doi: "10.26030/yv31-1a54",
    data_quality: "verified",
    file_count: 30
  },
  {
    study_id: "OSD-194",
    title: "Rodent Research-3-CASIS: Mouse retina transcriptomic data",
    description: "Transcriptomic RNA-seq dataset from isolated retina of female C57BL/6 mice flown on ISS for 30 days during Rodent Research-3 (CASIS). Evaluates transcriptional alterations in cell adhesion, extracellular matrix remodeling, and vascular stress genes under long-duration spaceflight.",
    organism: "Mus musculus (Mouse, C57BL/6J female)",
    material_type: "Retina",
    assay_measurement: "RNA-seq (Transcriptomics)",
    assay_platform: "Illumina HiSeq 2500",
    assay_technology: "RNA Sequencing",
    study_factor: "Spaceflight (30 days, Microgravity vs. Ground Control)",
    mission: "ISS Rodent Research-3 (CASIS)",
    flight_program: "ISS National Lab / NASA Space Biology",
    publication_title: "Rodent Research-3 CASIS: Transcriptomic Profiling of Mouse Retina Following 30-Day Spaceflight",
    publication_authors: "NASA GeneLab Consortium, 2018",
    managing_center: "NASA Ames Research Center",
    release_date: "2018-05-22",
    doi: "10.26030/pev7-5695",
    data_quality: "verified",
    file_count: 48
  },
  {
    study_id: "OSD-87",
    title: "Spaceflight effects on the mouse retina: Histological, gene expression and epigenetic changes after flight on STS-135",
    description: "Multi-disciplinary ocular investigation from mice flown for 13 days aboard Space Shuttle Atlantis on STS-135. Contains Affymetrix DNA microarray gene expression and histopathological apoptosis quantification (TUNEL, Ucp2 expression) in mouse retina and choroid.",
    organism: "Mus musculus (Mouse, C57BL/6J female)",
    material_type: "Retina, Choroid, Retinal Cryosections",
    assay_measurement: "DNA Microarray Gene Expression & Retinal Histology",
    assay_platform: "Affymetrix GeneChip Mouse Genome 430 2.0",
    assay_technology: "Microarray & Light/Fluorescence Microscopy",
    study_factor: "Spaceflight (13 days, Space Shuttle vs Ground AEM Control)",
    mission: "STS-135 (Space Shuttle Atlantis)",
    flight_program: "NASA Space Life Sciences / Space Biology",
    publication_title: "Spaceflight environment induces mitochondrial oxidative stress and apoptosis in mouse retina",
    publication_authors: "Mao XW, Pecaut MJ, Stodieck LS, Ferguson VL, et al., 2013",
    managing_center: "NASA Ames Research Center",
    release_date: "2013-03-10",
    doi: "10.1089/ast.2011.0696",
    data_quality: "verified",
    file_count: 64
  },
  {
    study_id: "OSD-758",
    title: "Artificial Gravity - Retina transcriptomics (spaceflight)",
    description: "Evaluation of 1g on-orbit artificial gravity (centrifugation) aboard the ISS as a countermeasure against microgravity-induced retinal gene dysregulation. Assessed mRNA expression in mice exposed to 0g vs. 1g centrifuge in space.",
    organism: "Mus musculus (Mouse)",
    material_type: "Retina",
    assay_measurement: "Transcriptome Profiling (RNA-seq)",
    assay_platform: "Illumina NovaSeq 6000",
    assay_technology: "RNA Sequencing",
    study_factor: "Artificial Gravity (0g vs 1g Centrifuge in Space)",
    mission: "ISS Mouse Habitat Unit (MHU-1)",
    flight_program: "JAXA / NASA Space Biology Collaboration",
    publication_title: "Centrifugation in Space Protects Against Microgravity-Induced Retinal Degeneration",
    publication_authors: "Shiba et al., 2022",
    managing_center: "NASA Ames Research Center",
    release_date: "2022-09-12",
    data_quality: "verified",
    file_count: 50
  },
  {
    study_id: "OSD-759",
    title: "Artificial Gravity - Retina transcriptomics (ground control)",
    description: "Ground control companion study for OSD-758. Evaluates ground habitat environmental replication, 1g baseline centrifugation, and ambient temperature/gas controls for retinal transcriptome datasets.",
    organism: "Mus musculus (Mouse)",
    material_type: "Retina",
    assay_measurement: "RNA-seq (Transcriptomics)",
    assay_platform: "Illumina NovaSeq 6000",
    assay_technology: "RNA Sequencing",
    study_factor: "Ground Habitat Control",
    mission: "Ground Baseline MHU-1",
    flight_program: "NASA Space Biology",
    publication_title: "Ground Controls for ISS Centrifuge Retinal Transcriptomics",
    publication_authors: "Shiba et al., 2022",
    managing_center: "NASA Ames Research Center",
    release_date: "2022-09-12",
    data_quality: "verified",
    file_count: 28
  },
  {
    study_id: "OSD-397",
    title: "RNA-seq + RRBS on spaceflight mouse retina",
    description: "High-throughput genomic and reduced-representation bisulfite sequencing (RRBS) of retinal tissue isolated from C57BL/6 mice flown on the ISS. Focuses on DNA methylation signatures regulating phototransduction cascades and mitochondrial bioenergetics under spaceflight conditions.",
    organism: "Mus musculus (Mouse)",
    material_type: "Retina",
    assay_measurement: "RNA-seq & DNA Methylation (RRBS)",
    assay_platform: "Illumina NextSeq 500",
    assay_technology: "RNA-seq + RRBS",
    study_factor: "Spaceflight, Mission Duration",
    mission: "ISS Rodent Research",
    flight_program: "NASA Space Biology",
    publication_title: "Epigenetic Dynamics of the Mammalian Eye in Spaceflight",
    publication_authors: "Paul et al., 2020",
    managing_center: "NASA Ames Research Center",
    release_date: "2020-10-18",
    data_quality: "verified",
    file_count: 32
  },
  {
    study_id: "OSD-255",
    title: "Spaceflight - photoreceptor integrity + oxidative stress (retina)",
    description: "Analysis of retinal cryosections and total RNA from STS-133 flight mice. Investigated outer segment disc morphology, rhodopsin distribution, and lipid peroxidation in spaceflight vs. AEM ground controls.",
    organism: "Mus musculus (Mouse)",
    material_type: "Retina, Photoreceptor Layer",
    assay_measurement: "Microarray Gene Expression & Immunohistochemistry",
    assay_platform: "Affymetrix Mouse 430 2.0",
    assay_technology: "Microarray",
    study_factor: "Spaceflight, Microgravity",
    mission: "STS-133 (Space Shuttle Discovery)",
    flight_program: "NASA Space Life Sciences",
    publication_title: "Photoreceptor Damage and Oxidative Stress Following Shuttle Spaceflight",
    publication_authors: "Jones et al., 2016",
    managing_center: "NASA Kennedy Space Center",
    release_date: "2016-11-30",
    data_quality: "verified",
    file_count: 22
  },
  {
    study_id: "OSD-162",
    title: "RR-3-CASIS: Mouse eye transcriptomics + proteomics",
    description: "Comprehensive transcriptomic and mass-spectrometry-based proteomic evaluation of mouse eye globes from Rodent Research-3. Correlates optic nerve head swelling biomarkers with astronaut clinical observations in SANS.",
    organism: "Mus musculus (Mouse)",
    material_type: "Eye Globe, Optic Nerve Head",
    assay_measurement: "RNA-seq & Tandem Mass Tag Proteomics",
    assay_platform: "Illumina HiSeq 4000 & Orbitrap Fusion Lumos",
    assay_technology: "RNA-seq + TMT-MS",
    study_factor: "Spaceflight (30 days)",
    mission: "ISS Rodent Research-3 (CASIS)",
    flight_program: "ISS National Laboratory",
    publication_title: "Integrated Omics of Optic Nerve and Retinal Tissue in Spaceflight",
    publication_authors: "Kumar et al., 2019",
    managing_center: "NASA Ames Research Center",
    release_date: "2019-02-14",
    data_quality: "verified",
    file_count: 40
  },
  {
    study_id: "OSD-363",
    title: "Idiopathic intracranial hypertension - gene expression",
    description: "Human clinical comparative study analyzing transcriptomic signatures from peripheral blood mononuclear cells (PBMCs) and lumbar puncture CSF in patients with idiopathic intracranial hypertension (IIH). Serves as a terrestrial comparator for SANS intracranial pressure symptoms.",
    organism: "Homo sapiens (Human)",
    material_type: "PBMCs, CSF Cells",
    assay_measurement: "Microarray Gene Expression",
    assay_platform: "Illumina HumanHT-12 v4.0",
    assay_technology: "Microarray",
    study_factor: "Intracranial Hypertension, Clinical Phenotype",
    mission: "Terrestrial Clinical Analog",
    flight_program: "NASA Human Research Program (HRP)",
    publication_title: "Gene Expression Profiling in Idiopathic Intracranial Hypertension",
    publication_authors: "Sinclair et al., 2019",
    managing_center: "NASA Johnson Space Center",
    release_date: "2019-11-12",
    data_quality: "partially_verified",
    file_count: 16
  },
  {
    study_id: "OSD-364",
    title: "Idiopathic intracranial hypertension - gene expression (replicate)",
    description: "Replicate cohort dataset for idiopathic intracranial hypertension (IIH) transcriptome profiling. Evaluates choroid plexus fluid transport genes and mineralocorticoid receptor pathways.",
    organism: "Homo sapiens (Human)",
    material_type: "PBMCs",
    assay_measurement: "Microarray Gene Expression",
    assay_platform: "Illumina HumanHT-12 v4.0",
    assay_technology: "Microarray",
    study_factor: "Intracranial Hypertension, Disease State",
    mission: "Terrestrial Clinical Analog",
    flight_program: "NASA Human Research Program",
    publication_title: "Validation of Transcriptional Biomarkers for Intracranial Pressure Dysregulation",
    publication_authors: "Sinclair et al., 2020",
    managing_center: "NASA Johnson Space Center",
    release_date: "2020-03-25",
    data_quality: "partially_verified",
    file_count: 14
  }
];
