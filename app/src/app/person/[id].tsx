import { useCallback, useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { api, inviteLink, type Relation, type RelativeKind, type Tree, type TreePerson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { years } from "@/lib/family";
import { colors, fonts } from "@/lib/theme";
import { Body, Button, Card, Choice, ErrorText, Field, Kicker, Loading, Screen, Title } from "@/components/ui";

const KINDS: { value: RelativeKind; label: string }[] = [
  { value: "parent", label: "Parent" },
  { value: "child", label: "Child" },
  { value: "sibling", label: "Brother or sister" },
  { value: "spouse", label: "Husband or wife" },
];

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
] as const;

type Gender = (typeof GENDERS)[number]["value"];

function relationText(r: Relation, personId: string): string {
  if (r.type === "parent") return r.a_id === personId ? "Child" : "Parent";
  if (r.type === "sibling") return "Brother or sister";
  return r.divorced ? "Former spouse (divorced)" : "Spouse";
}

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const [tree, setTree] = useState<Tree | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"view" | "edit" | "add">("view");
  const [link, setLink] = useState("");

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      setTree(await api(token).tree(id, 1));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!tree) {
    return error ? (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    ) : (
      <Loading />
    );
  }

  const person = tree.people.find((p) => p.id === id)!;
  const isMe = person.id === tree.me;
  const others = new Map(tree.people.map((p) => [p.id, p]));
  const links = tree.relations.filter((r) => (r.a_id === id || r.b_id === id) && r.status !== "removed");
  const spouses = links
    .filter((r) => r.type === "spouse" && r.status === "active" && !r.divorced)
    .map((r) => others.get(r.a_id === id ? r.b_id : r.a_id)!)
    .filter(Boolean);

  async function makeInvite() {
    setError("");
    try {
      const { token: inviteToken } = await api(token).invite(person.id);
      setLink(inviteLink(inviteToken));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function shareLink() {
    const message = `${person.full_name}, you've been added to our family tree on One Family. Join here: ${link}`;
    if (Platform.OS === "web") {
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav?.share) {
        await nav.share({ text: message }).catch(() => undefined);
        return;
      }
      await Clipboard.setStringAsync(message);
      setNotice("Invite message copied. Paste it into WhatsApp, SMS or email.");
      return;
    }
    await Share.share({ message });
  }

  async function removeLink(r: Relation) {
    setError("");
    setNotice("");
    try {
      await api(token).startRemovalVote(r.id);
      setNotice("Vote started. 4 relatives were picked at random; the link is removed if 3 agree.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleDivorce(r: Relation) {
    setError("");
    try {
      await api(token).setDivorced(r.id, !r.divorced);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: person.full_name }} />
      <Kicker>{isMe ? "YOU" : person.is_living === 0 ? "IN LOVING MEMORY" : person.has_account ? "MEMBER" : "NOT JOINED YET"}</Kicker>
      <Title>{person.full_name}</Title>
      {!!years(person) && <Body muted>{years(person)}</Body>}
      {(person.birthplace || person.country) && <Body muted>{[person.birthplace, person.country].filter(Boolean).join(", ")}</Body>}
      {!!person.story && <Body>{person.story}</Body>}

      <ErrorText>{error}</ErrorText>
      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      {mode === "view" && (
        <View style={styles.actions}>
          {person.can_edit && <Button title="Add a relative" onPress={() => setMode("add")} />}
          {person.can_edit && <Button kind="secondary" title="Edit details" onPress={() => setMode("edit")} />}
          <Button kind="secondary" title="View their tree" onPress={() => router.push({ pathname: "/tree", params: { root: person.id } })} />
        </View>
      )}

      {mode === "edit" && (
        <EditPerson
          person={person}
          onCancel={() => setMode("view")}
          onSave={async (input) => {
            await api(token).updatePerson(person.id, input);
            setMode("view");
            await load();
          }}
        />
      )}

      {mode === "add" && (
        <AddRelative
          person={person}
          spouses={spouses}
          token={token}
          onCancel={() => setMode("view")}
          onDone={async (msg) => {
            setMode("view");
            setNotice(msg);
            await load();
          }}
        />
      )}

      {person.can_edit && !isMe && !person.has_account && person.is_living === 1 && (
        <Card>
          <Text style={styles.cardTitle}>Invite {person.full_name} to join</Text>
          <Body muted>Joining is by invitation only. Create a link and send it yourself by WhatsApp, SMS or email. It's free.</Body>
          {link ? (
            <>
              <Text selectable style={styles.link}>{link}</Text>
              <Button title="Share invite" onPress={shareLink} />
            </>
          ) : (
            <Button title="Create invite link" onPress={makeInvite} />
          )}
        </Card>
      )}

      <Card>
        <Text style={styles.cardTitle}>Close family</Text>
        {links.length === 0 && <Body muted>No relatives linked yet.</Body>}
        {links.map((r) => {
          const otherId = r.a_id === id ? r.b_id : r.a_id;
          const other = others.get(otherId);
          if (!other) return null;
          const involved = r.a_id === tree.me || r.b_id === tree.me;
          return (
            <View key={r.id} style={styles.relation}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/person/[id]", params: { id: otherId } })}
                style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
              >
                <Text style={styles.relName}>{other.full_name}</Text>
                <Text style={styles.relMeta}>
                  {relationText(r, id)}
                  {r.status === "pending" ? " · awaiting approval" : ""}
                </Text>
              </Pressable>
              {r.type === "spouse" && r.status === "active" && (person.can_edit || involved) && (
                <Pressable accessibilityRole="button" onPress={() => toggleDivorce(r)} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>{r.divorced ? "Undo divorce" : "Mark divorced"}</Text>
                </Pressable>
              )}
              {r.status === "active" && (involved || person.can_edit) && (
                <Pressable accessibilityRole="button" onPress={() => removeLink(r)} style={styles.smallBtn}>
                  <Text style={[styles.smallBtnText, { color: colors.danger }]}>Wrong link?</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

function EditPerson({ person, onCancel, onSave }: { person: TreePerson; onCancel: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(person.full_name);
  const [gender, setGender] = useState<Gender>((person.gender as Gender) ?? "other");
  const [birth, setBirth] = useState(person.birth_year ? String(person.birth_year) : "");
  const [living, setLiving] = useState(person.is_living === 1 ? "yes" : "no");
  const [death, setDeath] = useState(person.death_year ? String(person.death_year) : "");
  const [place, setPlace] = useState(person.birthplace ?? "");
  const [country, setCountry] = useState(person.country ?? "");
  const [story, setStory] = useState(person.story ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Card>
      <Text style={styles.cardTitle}>Edit details</Text>
      <Field label="Full name" value={name} onChangeText={setName} />
      <Choice label="Gender" options={[...GENDERS]} value={gender} onChange={setGender} />
      <Field label="Birth year" value={birth} onChangeText={setBirth} keyboardType="number-pad" maxLength={4} />
      <Choice label="Living?" options={[{ value: "yes", label: "Living" }, { value: "no", label: "Passed away" }]} value={living} onChange={setLiving} />
      {living === "no" && <Field label="Year they passed away" value={death} onChangeText={setDeath} keyboardType="number-pad" maxLength={4} />}
      <Field label="Place of birth" value={place} onChangeText={setPlace} />
      <Field label="Country" value={country} onChangeText={setCountry} />
      <Field label="Short life story" value={story} onChangeText={setStory} multiline style={{ minHeight: 96, textAlignVertical: "top" }} />
      <ErrorText>{error}</ErrorText>
      <Button
        title="Save"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            await onSave({
              full_name: name,
              gender,
              birth_year: birth ? Number(birth) : null,
              is_living: living === "yes",
              death_year: living === "no" && death ? Number(death) : null,
              birthplace: place,
              country,
              story,
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button kind="secondary" title="Cancel" onPress={onCancel} />
    </Card>
  );
}

function AddRelative({
  person,
  spouses,
  token,
  onCancel,
  onDone,
}: {
  person: TreePerson;
  spouses: TreePerson[];
  token: string | null;
  onCancel: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<RelativeKind>("parent");
  const [source, setSource] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [birth, setBirth] = useState("");
  const [living, setLiving] = useState("yes");
  const [death, setDeath] = useState("");
  const [otherParent, setOtherParent] = useState<string>("none");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; full_name: string; birth_year: number | null }[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needsApproval = kind === "sibling" || kind === "spouse";

  async function search(q: string) {
    setQuery(q);
    setPicked(null);
    if (q.trim().length < 2) return setResults([]);
    try {
      setResults((await api(token).search(q)).filter((p) => p.id !== person.id));
    } catch {
      setResults([]);
    }
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api(token).addRelative({
        kind,
        of: person.id,
        ...(source === "existing" && picked
          ? { existingPersonId: picked }
          : {
              person: {
                full_name: name,
                gender,
                birth_year: birth ? Number(birth) : null,
                is_living: living === "yes",
                death_year: living === "no" && death ? Number(death) : null,
              },
            }),
        ...(kind === "child" && otherParent !== "none" ? { otherParentId: otherParent } : {}),
      });
      await onDone(
        needsApproval && living === "yes"
          ? "Added. This link shows as awaiting approval until they confirm it."
          : "Added to the tree.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text style={styles.cardTitle}>Add a relative of {person.full_name}</Text>
      <Choice label="Relation" options={KINDS} value={kind} onChange={setKind} />
      <Body muted>
        {needsApproval
          ? "Brothers, sisters, husbands and wives must approve the link before it is confirmed."
          : "Parents and children are linked straight away."}
      </Body>
      <Choice
        label="Who?"
        options={[{ value: "new", label: "Someone new" }, { value: "existing", label: "Already in the tree" }]}
        value={source}
        onChange={setSource}
      />
      {source === "existing" ? (
        <>
          <Field label="Search by name" value={query} onChangeText={search} />
          {results.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: picked === r.id }}
              onPress={() => setPicked(r.id)}
              style={[styles.result, picked === r.id && { borderColor: colors.gold }]}
            >
              <Text style={styles.relName}>{r.full_name}</Text>
              {!!r.birth_year && <Text style={styles.relMeta}>Born {r.birth_year}</Text>}
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <Field label="Full name" value={name} onChangeText={setName} />
          <Choice label="Gender" options={[...GENDERS]} value={gender} onChange={setGender} />
          <Field label="Birth year (optional)" value={birth} onChangeText={setBirth} keyboardType="number-pad" maxLength={4} />
          <Choice label="Living?" options={[{ value: "yes", label: "Living" }, { value: "no", label: "Passed away" }]} value={living} onChange={setLiving} />
          {living === "no" && <Field label="Year they passed away (optional)" value={death} onChangeText={setDeath} keyboardType="number-pad" maxLength={4} />}
        </>
      )}
      {kind === "child" && spouses.length > 0 && (
        <Choice
          label="Other parent"
          options={[{ value: "none", label: "Not listed" }, ...spouses.map((s) => ({ value: s.id, label: s.full_name }))]}
          value={otherParent}
          onChange={setOtherParent}
        />
      )}
      <ErrorText>{error}</ErrorText>
      <Button title="Add" busy={busy} onPress={submit} disabled={source === "existing" ? !picked : !name.trim()} />
      <Button kind="secondary" title="Cancel" onPress={onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  cardTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.text },
  notice: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.teal },
  link: { fontFamily: fonts.body, fontSize: 14, color: colors.goldSoft },
  relation: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: colors.lanternBorder, paddingTop: 8 },
  relName: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.text },
  relMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  smallBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  smallBtnText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.gold },
  result: { minHeight: 48, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.cardBorder, justifyContent: "center" },
});
