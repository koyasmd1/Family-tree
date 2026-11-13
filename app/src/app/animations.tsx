// A page that shows every One Family animation at once, at /animations.
// Useful for checking how they look on a phone, a tablet or a computer.
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { colors, fonts } from "@/lib/theme";
import { SeedToTree } from "@/components/animations";
import {
  BirthBloom,
  Constellation,
  EarthEmbrace,
  EndlessBond,
  FallingPetals,
  GoldenPath,
  Heartline,
  InkTitle,
  JourneyBack,
  KinshipWave,
  LanternRelease,
  NorthernGlow,
  OneEarth,
  Ripple,
  SealOfApproval,
  SiblingOrbit,
  VoteOfFour,
  WovenThreads,
} from "@/components/moments";
import { PersonCard } from "@/components/PersonCard";
import { TreeLines } from "@/components/TreeLines";
import type { Relation, TreePerson } from "@/lib/api";
import { Kicker, Screen, Title } from "@/components/ui";

const person = (id: string, full_name: string, extra: Partial<TreePerson> = {}): TreePerson => ({
  id,
  full_name,
  is_living: 1,
  has_account: true,
  can_edit: false,
  ...extra,
});

const rel = (id: string, type: Relation["type"], a_id: string, b_id: string, extra: Partial<Relation> = {}): Relation => ({
  id,
  type,
  a_id,
  b_id,
  status: "active",
  approver_id: null,
  divorced: 0,
  created_by: null,
  ...extra,
});

function Tile({ n, name, where, children }: { n: string; name: string; where: string; children: ReactNode }) {
  return (
    <View style={styles.tile}>
      <View style={styles.stage}>{children}</View>
      <Text style={styles.n}>{n}</Text>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.where}>{where}</Text>
    </View>
  );
}

/** A tiny tree: two parents, a married couple and their child, to show the lines. */
function MiniTree() {
  const boxes = new Map([
    ["p1", { x: 10, y: 20, w: 90, h: 40 }],
    ["p2", { x: 120, y: 20, w: 90, h: 40 }],
    ["c", { x: 65, y: 120, w: 90, h: 40 }],
  ]);
  const relations = [rel("r1", "parent", "p1", "c"), rel("r2", "parent", "p2", "c"), rel("r3", "spouse", "p1", "p2")];
  return (
    <View style={{ width: 220, height: 180 }}>
      <TreeLines relations={relations} boxes={boxes} width={220} height={180} />
      {[...boxes.entries()].map(([id, b]) => (
        <View key={id} style={[styles.miniCard, { left: b.x, top: b.y, width: b.w, height: b.h }]} />
      ))}
    </View>
  );
}

export default function AnimationsGallery() {
  return (
    <Screen>
      <Stack.Screen options={{ title: "Animations" }} />
      <NorthernGlow style={{ paddingVertical: 12, gap: 8 }}>
        <Kicker>ONE FAMILY</Kicker>
        <Title>All 25 animations</Title>
      </NorthernGlow>
      <View style={styles.grid}>
        <Tile n="01" name="Seed to Tree" where="Sign-in page">
          <SeedToTree size={150} />
        </Tile>
        <Tile n="02, 08, 16" name="Heartbeat Link, Root Rivers, Marriage Bridge" where="The lines in the tree">
          <MiniTree />
        </Tile>
        <Tile n="03, 05, 07" name="Lantern Ancestors, Ripple of Kinship, Waiting Breath" where="Cards in the tree">
          <View style={{ gap: 0, alignItems: "center", transform: [{ scale: 0.8 }] }}>
            <PersonCard person={person("a", "Yusuf", { is_living: 0, birth_year: 1925, death_year: 1998 })} label="Grandfather" isMe={false} pending={false} onPress={() => undefined} />
            <PersonCard person={person("b", "You")} label="You" isMe pending={false} onPress={() => undefined} />
          </View>
        </Tile>
        <Tile n="04" name="Family Constellation" where="Behind the tree">
          <View style={{ width: 220, height: 180, borderRadius: 12, overflow: "hidden" }}>
            <Constellation />
          </View>
        </Tile>
        <Tile n="05" name="Ripple of Kinship" where="Your card, when the tree opens">
          <View style={{ width: 120, height: 60, borderRadius: 12, backgroundColor: colors.meCard, borderWidth: 1, borderColor: colors.gold }}>
            <Ripple />
          </View>
        </Tile>
        <Tile n="06" name="Woven Threads" where="Approving a husband or wife">
          <WovenThreads size={200} />
        </Tile>
        <Tile n="07" name="Waiting Breath" where="A link awaiting approval">
          <PersonCard person={person("s", "Sara")} label="Sister" isMe={false} pending onPress={() => undefined} />
        </Tile>
        <Tile n="09" name="Birth Bloom" where="Adding a child">
          <BirthBloom size={200} />
        </Tile>
        <Tile n="10" name="One Earth" where="Opening an invite link">
          <OneEarth size={200} />
        </Tile>
        <Tile n="11" name="Golden Path" where="How you're related, on a person's page">
          <View style={{ width: 220 }}>
            <GoldenPath steps={[{ name: "You", relation: "Start" }, { name: "Ahmed", relation: "Your father" }, { name: "Yusuf", relation: "Ahmed's father" }]} />
          </View>
        </Tile>
        <Tile n="12" name="Generations Rise" where="Rows of the tree, oldest first">
          <Text style={styles.where}>Each row of the tree slides up into place when it opens.</Text>
        </Tile>
        <Tile n="13" name="Written in Ink" where="A person's name on their page">
          <InkTitle text="Fatima" />
        </Tile>
        <Tile n="14" name="Sibling Orbit" where="While a page is loading">
          <SiblingOrbit size={150} />
        </Tile>
        <Tile n="15" name="Falling Petals" where="The page of a relative who passed away">
          <View style={{ width: 220, height: 180, borderRadius: 12, backgroundColor: colors.lantern, overflow: "hidden" }}>
            <FallingPetals height={180} />
          </View>
        </Tile>
        <Tile n="17" name="Endless Bond" where="Adding a parent">
          <EndlessBond size={200} />
        </Tile>
        <Tile n="18" name="Kinship Wave" where="Joining through an invite">
          <KinshipWave size={200} />
        </Tile>
        <Tile n="19" name="Seal of Approval" where="Approving a brother or sister">
          <SealOfApproval size={200} />
        </Tile>
        <Tile n="20" name="Vote of Four" where="A removal vote">
          <VoteOfFour agree={3} disagree={1} />
        </Tile>
        <Tile n="21" name="Northern Glow" where="Behind the app's title">
          <NorthernGlow style={{ width: 220, height: 120, justifyContent: "center" }}>
            <Text style={[styles.name, { textAlign: "center", fontSize: 24 }]}>One Family</Text>
          </NorthernGlow>
        </Tile>
        <Tile n="22" name="Heartline" where="A tree that has only you">
          <Heartline size={200} />
        </Tile>
        <Tile n="23" name="Lantern Release" where="Marking a relative as passed away">
          <LanternRelease size={200} />
        </Tile>
        <Tile n="24" name="Journey Back in Time" where="Opening an older relative's tree">
          <JourneyBack size={200} />
        </Tile>
        <Tile n="25" name="Earth Embrace" where="The end of the tree">
          <EarthEmbrace size={180} />
        </Tile>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16, justifyContent: "center" },
  tile: { width: 300, maxWidth: "100%", gap: 4, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.lanternBorder, backgroundColor: colors.deep },
  stage: { height: 230, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  n: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.gold },
  name: { fontFamily: fonts.display, fontSize: 18, color: colors.text },
  where: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  miniCard: { position: "absolute", borderRadius: 10, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
});
