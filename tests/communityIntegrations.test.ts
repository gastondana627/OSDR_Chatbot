import assert from "assert";
import http from "http";
import { createExpressApp } from "../server/app";
import { buildAwgEvidenceMap } from "../server/awg";
import { getStudyById } from "../server/rag";
import { getStudyManifest } from "../server/studyManifests";
import {
  buildContributorManifest,
  formatForumAnnouncementText,
  formatGitHubContributionBlock,
  parseTargetOsdrStudyIds,
} from "../src/utils/contributorManifest.js";

function startEphemeralServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = createExpressApp();
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function runCommunityIntegrationsTests() {
  console.log("▶ Running Community Integrations, Frozen-Panel Schema Contracts & Citation Alignment Tests...\n");

  // Test 1: HTTP GET /api/awg/integrations serves RetinaCellTwin showcase + live Schema Contracts
  console.log("Test 1: HTTP GET /api/awg/integrations Endpoint & RetinaCellTwin Attribution");
  {
    const { server, baseUrl } = await startEphemeralServer();
    try {
      const res = await fetch(`${baseUrl}/api/awg/integrations`);
      assert.strictEqual(res.status, 200, "GET /api/awg/integrations must return HTTP 200");
      const json: any = await res.json();
      assert.strictEqual(json.status, "ok");
      assert.ok(
        typeof json.attributionNotice === "string" &&
          json.attributionNotice.toLowerCase().includes("not endorsed by"),
        "Must include independent non-NASA-endorsed attribution notice"
      );

      const retinaTwin = (json.contributors || []).find((c: any) => c.id === "retinacelltwin");
      assert.ok(retinaTwin, "Must include RetinaCellTwin contributor entry");
      assert.strictEqual(retinaTwin.name, "RetinaCellTwin");
      assert.strictEqual(retinaTwin.creatorLabel, "Lissandra Kruse Fuganti (fuganti)");
      assert.strictEqual(
        retinaTwin.externalUrl,
        "https://retina-cell-twin-osdr.fuganti.chatgpt.site/"
      );
      assert.ok(
        typeof retinaTwin.repositoryUrl === "string" &&
          retinaTwin.repositoryUrl.includes("github.com/gastondana627/OSDR_Chatbot"),
        "Must expose repositoryUrl for aligned contract spec"
      );
      assert.strictEqual(retinaTwin.status, "external_research_prototype");

      const tplMhu8 = (json.handshakeTemplates || []).find(
        (t: any) => t.id === "osd255-x-osd758-mhu8"
      );
      assert.ok(tplMhu8, "Must include OSD-255 × OSD-758 handshake template");
      assert.deepStrictEqual(tplMhu8.studyPair, ["OSD-255", "OSD-758"]);
      assert.strictEqual(tplMhu8.frozenPanelPolicy?.referenceAccession, "OSD-255");
      assert.strictEqual(tplMhu8.frozenPanelPolicy?.discoveryPanelSize, 362);
      assert.ok(tplMhu8.contractPreview, "OSD-255 × OSD-758 contractPreview must be populated");

      const tplAnalog = (json.handshakeTemplates || []).find(
        (t: any) => t.id === "osd255-x-osd203-analog"
      );
      assert.ok(tplAnalog, "Must include OSD-255 × OSD-203 handshake template");
      assert.deepStrictEqual(tplAnalog.studyPair, ["OSD-255", "OSD-203"]);
      assert.ok(tplAnalog.contractPreview, "OSD-255 × OSD-203 contractPreview must be populated");

      const tplImg = (json.handshakeTemplates || []).find(
        (t: any) => t.id === "osd557-x-osd568-imaging"
      );
      assert.ok(tplImg, "Must include OSD-557 × OSD-568 imaging handshake template");
      assert.deepStrictEqual(tplImg.studyPair, ["OSD-557", "OSD-568"]);

      console.log("  ✔ GET /api/awg/integrations serves RetinaCellTwin (Lissandra / fuganti) & 3 valid Schema Contracts");
    } finally {
      server.close();
    }
  }

  // Test 2: FROZEN_PANEL_FDR_GUARDRAIL & zero-shared-animals contracts on OSD-255 × OSD-758 / OSD-203
  console.log("\nTest 2: FROZEN_PANEL_FDR_GUARDRAIL & Schema Contracts on OSD-255 Pairs");
  {
    const s255 = getStudyById("OSD-255")!;
    const s758 = getStudyById("OSD-758")!;
    const s203 = getStudyById("OSD-203")!;
    assert.ok(s255 && s758 && s203, "OSD-255, OSD-758, and OSD-203 must resolve in catalog");

    const map255_758 = buildAwgEvidenceMap(s255, s758);
    const codes758 = new Set((map255_758.schemaGuardrails || []).map((g) => g.code));
    assert.ok(codes758.has("ZERO_SHARED_ANIMALS"), "OSD-255 × OSD-758 must emit ZERO_SHARED_ANIMALS");
    assert.ok(codes758.has("P_GT_N_ANIMAL_DISJOINT"), "OSD-255 × OSD-758 must emit P_GT_N_ANIMAL_DISJOINT");
    assert.ok(codes758.has("COHORT_BATCH_CONTROLS"), "OSD-255 × OSD-758 must emit COHORT_BATCH_CONTROLS");
    assert.ok(codes758.has("FROZEN_PANEL_FDR_GUARDRAIL"), "OSD-255 × OSD-758 must emit FROZEN_PANEL_FDR_GUARDRAIL");
    assert.strictEqual(map255_758.schemaContract?.sameMission, false);
    assert.strictEqual(map255_758.schemaContract?.frozenPanelPolicy?.referenceAccession, "OSD-255");
    assert.strictEqual(map255_758.schemaContract?.frozenPanelPolicy?.discoveryPanelSize, 362);

    const map255_203 = buildAwgEvidenceMap(s255, s203);
    const codes203 = new Set((map255_203.schemaGuardrails || []).map((g) => g.code));
    assert.ok(codes203.has("ZERO_SHARED_ANIMALS"), "OSD-255 × OSD-203 must emit ZERO_SHARED_ANIMALS");
    assert.ok(codes203.has("P_GT_N_ANIMAL_DISJOINT"), "OSD-255 × OSD-203 must emit P_GT_N_ANIMAL_DISJOINT");
    assert.ok(codes203.has("COHORT_BATCH_CONTROLS"), "OSD-255 × OSD-203 must emit COHORT_BATCH_CONTROLS");
    assert.ok(codes203.has("FROZEN_PANEL_FDR_GUARDRAIL"), "OSD-255 × OSD-203 must emit FROZEN_PANEL_FDR_GUARDRAIL");
    assert.strictEqual(map255_203.schemaContract?.frozenPanelPolicy?.referenceAccession, "OSD-255");

    console.log("  ✔ Cross-mission OSD-255 schema contracts enforce animal-disjoint & frozen-panel FDR rules");
  }

  // Test 3: Citation & Manifest Alignment Invariants (OSD-87, OSD-583, OSD-758, OSD-759, OSD-203, OSD-568)
  console.log("\nTest 3: Aligned Citations & Sample Counts Across Manifests and Studies");
  {
    const s87m = getStudyManifest("OSD-87")!;
    const s87d = getStudyById("OSD-87")!;
    assert.strictEqual(s87m.linkedPublications[0].doi, "10.1667/RR3309.1");
    assert.strictEqual(s87m.linkedPublications[0].pmid, "24033191");
    assert.strictEqual(s87m.linkedPublications[0].journal, "Radiation Research");
    assert.ok(s87m.linkedPublications[0].authors.includes("Stodieck"));
    assert.strictEqual(s87d.doi, "10.1667/RR3309.1");
    assert.strictEqual(s87d.pmid, "24033191");

    const s583m = getStudyManifest("OSD-583")!;
    assert.strictEqual(s583m.linkedPublications[0].doi, "10.1038/s41598-019-44696-0");
    assert.strictEqual(s583m.linkedPublications[0].pmid, "31160660");
    assert.ok(s583m.linkedPublications[0].authors.includes("Nishiyama"));

    const s758m = getStudyManifest("OSD-758")!;
    const s759m = getStudyManifest("OSD-759")!;
    assert.strictEqual(s758m.organism.sampleCount, 35);
    assert.strictEqual(s759m.organism.sampleCount, 35);
    assert.ok(s758m.mission.name.includes("MHU-8"));
    assert.strictEqual(s758m.linkedPublications[0].doi, "10.3390/ijms252212041");
    assert.strictEqual(s758m.linkedPublications[0].pmid, "39596110");
    assert.strictEqual(s759m.linkedPublications[0].doi, "10.3390/ijms252212041");

    const s203m = getStudyManifest("OSD-203")!;
    assert.strictEqual(s203m.organism.sampleCount, 59);
    assert.strictEqual(s203m.linkedPublications[0].doi, "10.1038/s41598-022-19360-9");
    assert.strictEqual(s203m.linkedPublications[0].pmid, "36207342");
    assert.ok(s203m.assays.some((a) => a.name.includes("RRBS")));

    const s568m = getStudyManifest("OSD-568")!;
    const s568d = getStudyById("OSD-568")!;
    assert.strictEqual(s568m.organism.sampleCount, 23);
    assert.strictEqual(s568m.linkedPublications[0].doi, "10.1038/s41598-019-44696-0");
    assert.ok(JSON.stringify(s568m).includes("10.26030/d09k-4e68"));
    assert.ok(s568d.assay_measurement.includes("TUNEL") && s568d.assay_measurement.includes("ZO-1"));

    console.log("  ✔ All 6 aligned study records (OSD-87, 583, 758, 759, 203, 568) verified cleanly");
  }

  // Test 4: Contributor Submission Intake & Manifest Generator Unit Checks
  console.log("\nTest 4: Contributor Submission Manifest Generator & Forum/PR Formatters");
  {
    const parsed = parseTargetOsdrStudyIds("osd-255, OSD685; badtoken, osd-255, OSD-758");
    assert.deepStrictEqual(parsed.validIds, ["OSD-255", "OSD-685", "OSD-758"]);
    assert.deepStrictEqual(parsed.invalidTokens, ["badtoken"]);

    const manifest = buildContributorManifest({
      contributorName: "Lissandra Kruse Fuganti",
      forumHandle: "fuganti",
      awgSubgroup: "AIML AWG",
      affiliation: "Retinal Digital Twin Subgroup",
      projectTitle: "RetinaCellTwin",
      abstract: "Probabilistic multimodal OSDR retina research twin.",
      liveDemoUrl: "https://retina-cell-twin-osdr.fuganti.chatgpt.site/",
      repositoryOrPaperUrl: "https://github.com/example/retinadraft",
      targetStudyIds: "osd-255, OSD-758, OSD-203",
    });

    assert.strictEqual(manifest.manifestType, "osdr_chatbot_contributor_submission");
    assert.strictEqual(manifest.contributor.handle, "@fuganti");
    assert.deepStrictEqual(manifest.osdrIntegration.targetStudyIds, [
      "OSD-255",
      "OSD-758",
      "OSD-203",
    ]);
    assert.strictEqual(manifest.osdrIntegration.includesRetinalFrozenPanelPolicy, true);
    assert.strictEqual(manifest.osdrIntegration.frozenPanelReference?.discoveryPanelSize, 362);

    const ghBlock = formatGitHubContributionBlock(manifest);
    assert.ok(ghBlock.includes("### Community Contributor Hub Submission: RetinaCellTwin"));
    assert.ok(ghBlock.includes("contributor_manifest.json"));
    assert.ok(ghBlock.includes("not affiliated with or endorsed by NASA"));

    const forumText = formatForumAnnouncementText(manifest);
    assert.ok(forumText.includes("RetinaCellTwin"));
    assert.ok(forumText.includes("@fuganti"));
    assert.ok(forumText.includes("OSD-255, OSD-758, OSD-203"));

    console.log("  ✔ Intake manifest builder, OSD parser, and GitHub/Forum formatters verified cleanly");
  }

  console.log("\n======================================================================");
  console.log("🎉 ALL COMMUNITY INTEGRATIONS & SCHEMA HANDSHAKE TESTS PASSED!");
  console.log("======================================================================\n");
}

runCommunityIntegrationsTests().catch((err) => {
  console.error("❌ Community integrations test failed:", err);
  process.exit(1);
});

