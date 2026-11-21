import assert from "node:assert/strict";
import {
  AWG_PROFILE_SUBGROUPS,
  computeProfileInitials,
  deleteResearcherProfile,
  exportResearcherProfilePayload,
  getPersonalizedPresetsForProfile,
  loadResearcherProfile,
  mapProfileToContributorDefaults,
  normalizeOrcid,
  parseImportedResearcherProfile,
  saveResearcherProfile,
  validateOrcidFormat,
} from "../src/utils/researcherProfile.js";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

async function runTests() {
  console.log("Running AWG Researcher Profile & Onboarding Walkthrough unit tests...\n");

  const storage = new MemoryStorage();

  // Test 1: Default profile hydration & UID isolation
  {
    const userA = { uid: "uid-alpha-001", displayName: "Dr. Ada Lovelace", email: "ada@nasa.gov" };
    const userB = { uid: "uid-beta-002", displayName: "Dr. Carl Sagan", email: "carl@cornell.edu" };

    const defaultA = loadResearcherProfile(userA.uid, userA, storage);
    assert.equal(defaultA.uid, userA.uid);
    assert.equal(defaultA.displayName, "Dr. Ada Lovelace");
    assert.equal(defaultA.onboardingCompleted, false);
    assert.deepEqual(defaultA.awgSubgroups, []);

    const savedA = saveResearcherProfile(
      userA.uid,
      {
        affiliation: "NASA Ames Research Center",
        roleTitle: "AIML AWG Lead",
        forumHandle: "ada_osdr",
        orcid: "https://orcid.org/0000-0002-1825-0097",
        awgSubgroups: ["AIML AWG", "Animal AWG", "Invalid Group Should Drop", "AIML AWG"],
        avatarAccent: "violet",
        preferredModel: "meta-llama/llama-3.3-70b-instruct:free",
        defaultAwgMode: true,
        onboardingCompleted: true,
      },
      userA,
      storage
    );

    assert.equal(savedA.orcid, "0000-0002-1825-0097", "ORCID URL must normalize cleanly");
    assert.equal(savedA.forumHandle, "@ada_osdr", "Forum handle must auto-prefix @");
    assert.deepEqual(
      savedA.awgSubgroups,
      ["AIML AWG", "Animal AWG"],
      "Unknown or duplicate subgroups must be filtered out"
    );
    assert.equal(savedA.onboardingCompleted, true);
    assert.equal(savedA.defaultAwgMode, true);

    // Ensure strict UID isolation between User A and User B
    const loadedB = loadResearcherProfile(userB.uid, userB, storage);
    assert.deepEqual(loadedB.awgSubgroups, [], "User B must not inherit User A's AWG subgroups");
    assert.equal(loadedB.affiliation, "", "User B must have isolated local storage");
    console.log("✓ Test 1 passed: Default hydration, sanitization & strict per-UID isolation");
  }

  // Test 2: ORCID validation & normalization
  {
    assert.equal(validateOrcidFormat("").valid, true);
    assert.equal(validateOrcidFormat("0000-0002-1825-0097").valid, true);
    assert.equal(validateOrcidFormat("https://orcid.org/0000-0001-5109-3700").normalized, "0000-0001-5109-3700");
    assert.equal(validateOrcidFormat("0000-0002-1694-233x").normalized, "0000-0002-1694-233X");
    assert.equal(validateOrcidFormat("not-an-orcid").valid, false);
    assert.equal(normalizeOrcid("https://www.orcid.org/0000-0002-1825-0097/"), "0000-0002-1825-0097");
    console.log("✓ Test 2 passed: ORCID format validation & URL normalization");
  }

  // Test 3: Personalized AWG preset ranking & Contributor Hub mapping
  {
    const plantProfile = {
      displayName: "Dr. Flora Root",
      forumHandle: "@flora",
      affiliation: "Kennedy Space Botany Lab",
      orcid: "0000-0002-1825-0097",
      awgSubgroups: ["Radiation / Space Health AWG", "Animal AWG"],
    };

    const presets = getPersonalizedPresetsForProfile(plantProfile);
    assert.equal(presets.length, 4);
    assert.equal(presets[0].isMatched, true, "Matched AWG presets must float to the top");
    assert.ok(
      presets[0].id === "rr18-brain-buoe" || presets[0].id === "sex-epigenetic-eye",
      "Presets matching both Radiation & Animal AWG should rank first"
    );

    const contribDefaults = mapProfileToContributorDefaults(plantProfile);
    assert.equal(contribDefaults.contributorName, "Dr. Flora Root");
    assert.equal(contribDefaults.forumHandle, "@flora");
    assert.ok(contribDefaults.affiliation.includes("Kennedy Space Botany Lab"));
    assert.ok(contribDefaults.affiliation.includes("0000-0002-1825-0097"));
    assert.equal(computeProfileInitials({ displayName: "Dr. Flora Root" }), "DF");
    assert.equal(computeProfileInitials({ displayName: "Dr. Flora Root", avatarBadge: "awg" }), "AWG");
    console.log("✓ Test 3 passed: Personalized AWG preset ranking & Contributor Hub auto-fill mapping");
  }

  // Test 4: JSON Export / Import portability & destructive delete reset
  {
    const loadedA = loadResearcherProfile("uid-alpha-001", null, storage);
    const exported = exportResearcherProfilePayload(loadedA);
    assert.equal(exported.exportFormat, "osdr_researcher_profile_v1");
    assert.deepEqual(exported.profile.awgSubgroups, ["AIML AWG", "Animal AWG"]);

    const importedForNewMachine = parseImportedResearcherProfile(
      JSON.stringify(exported),
      "uid-gamma-003",
      { email: "ada@nasa.gov" }
    );
    assert.equal(importedForNewMachine.uid, "uid-gamma-003");
    assert.equal(importedForNewMachine.affiliation, "NASA Ames Research Center");
    assert.deepEqual(importedForNewMachine.awgSubgroups, ["AIML AWG", "Animal AWG"]);

    assert.throws(
      () => parseImportedResearcherProfile("{broken json", "uid-gamma-003"),
      /Invalid JSON file/
    );
    assert.throws(
      () => parseImportedResearcherProfile(JSON.stringify({ unrelated: true }), "uid-gamma-003"),
      /recognized OSDR researcher profile/
    );

    // Delete local profile cleanly
    deleteResearcherProfile("uid-alpha-001", storage);
    const afterDelete = loadResearcherProfile("uid-alpha-001", { displayName: "Ada" }, storage);
    assert.equal(afterDelete.onboardingCompleted, false);
    assert.deepEqual(afterDelete.awgSubgroups, []);
    assert.ok(AWG_PROFILE_SUBGROUPS.length >= 9, "All NASA OSDR AWG subgroups should be cataloged");
    console.log("✓ Test 4 passed: JSON export/import round-trip, validation & clean local deletion");
  }

  console.log("\nAll 4 AWG Researcher Profile unit tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
