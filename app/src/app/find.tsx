import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api, type FoundPerson, type Me, type RelativeKind } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { myRequestText } from "@/lib/family";
import { colors, fonts } from "@/lib/theme";
import { Body, Button, Card, Choice, ErrorText, Field, Kicker, Loading, Screen, Title } from "@/components/ui";
import { Celebration, type Moment } from "@/components/Celebration";

const KINDS: { value: RelativeKind; label: string }[] = [
  { value: "parent", label: "My parent" },
  { value: "child", label: "My child" },
  { value: "sibling", label: "My brother or sister" },
  { value: "spouse", label: "My husband or wife" },
];

const STATUS: Record<string, string> = {
  open: "Waiting for a relative to confirm",
  approved: "Confirmed",
  rejected: "Not confirmed",
};

/**
 * For someone who signed up without an invite: find yourself ("This is me")
 * or a relative ("This is my relative") in the tree. Relatives then confirm it.
 */
export default function FindYourFamily() {
  const { token, ready, signOut } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundPerson[]>([]);
  const [linking, setLinking] = useState<FoundPerson | null>(null);
  const [kind, setKind] = useState<RelativeKind>("parent");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [moment, setMoment] = useState<Moment | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    if (!token) return router.replace("/welcome");
    try {
      const m = await api(token).me();
      setMe(m);
      if (m.person.in_tree !== 0) {
        setMoment({ kind: "kinship", title: "You're in the family tree", body: "A relative confirmed you. Now you can add everyone you know." });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token, ready]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function search(q: string) {
    setQuery(q);
    setLinking(null);
    if (q.trim().length < 2) return setResults([]);
    try {
      setResults(await api(token).search(q));
    } catch {
      setResults([]);
    }
  }

  async function act(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      setNotice(await fn());
      setLinking(null);
      setResults([]);
      setQuery("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!me) return error ? <Screen><ErrorText>{error}</ErrorText></Screen> : <Loading />;

  const open = me.requests.filter((r) => r.status === "open");
  return (
    <Screen>
      <Kicker>WELCOME, {me.person.full_name.toUpperCase()}</Kicker>
      <Title>Find your family</Title>
      <Body muted>
        Search for your own name. A relative may already have added you. If you're not there, search for a parent,
        child, brother, sister, husband or wife who is. A relative who has joined will confirm it's really you.
      </Body>

      {!!notice && <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text>}
      <ErrorText>{error}</ErrorText>

      {me.requests.length > 0 && (
        <Card>
          <Text style={styles.cardTitle}>Your requests</Text>
          {me.requests.map((r) => (
            <View key={r.id} style={styles.request}>
              <Text style={styles.name}>{myRequestText(r)}</Text>
              <Text style={[styles.meta, r.status === "approved" && { color: colors.teal }, r.status === "rejected" && { color: colors.danger }]}>
                {STATUS[r.status]}
                {r.status === "open" && r.checkers > 1 ? ` (${r.checkers} relatives asked)` : ""}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {open.length < 3 && (
        <Card>
          <Field label="Search by name" value={query} onChangeText={search} autoCapitalize="words" />
          {query.trim().length >= 2 && results.length === 0 && <Body muted>Nobody with that name in the tree yet.</Body>}
          {results.map((p) => (
            <View key={p.id} style={styles.result}>
              <Text style={styles.name}>{p.full_name}</Text>
              <Text style={styles.meta}>
                {[p.birth_year ? `Born ${p.birth_year}` : "", p.is_living === 0 ? "Passed away" : "", p.parents?.length ? `Child of ${p.parents.join(" and ")}` : ""]
                  .filter(Boolean)
                  .join(" · ") || "No details"}
              </Text>
              {linking?.id === p.id ? (
                <View style={{ gap: 10 }}>
                  <Choice label={`${p.full_name} is…`} options={KINDS} value={kind} onChange={setKind} />
                  <Button
                    title="Ask to connect"
                    busy={busy === p.id + "link"}
                    onPress={() =>
                      act(p.id + "link", async () => {
                        await api(token).addRelative({ kind, of: me.person.id, existingPersonId: p.id });
                        return `Sent. A relative of ${p.full_name} will confirm it.`;
                      })
                    }
                  />
                  <Button kind="secondary" title="Cancel" onPress={() => setLinking(null)} />
                </View>
              ) : (
                <View style={styles.actions}>
                  {!p.has_account && p.is_living === 1 && (
                    <Pressable
                      accessibilityRole="button"
                      style={styles.smallBtn}
                      onPress={() =>
                        act(p.id + "claim", async () => {
                          await api(token).claim(p.id);
                          return `Sent. A relative will confirm that you are ${p.full_name}.`;
                        })
                      }
                    >
                      <Text style={styles.smallBtnText}>{busy === p.id + "claim" ? "Sending…" : "This is me"}</Text>
                    </Pressable>
                  )}
                  <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={() => setLinking(p)}>
                    <Text style={styles.smallBtnText}>This is my relative</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </Card>
      )}

      <Button kind="secondary" title="Check again" onPress={load} />
      <Button
        kind="secondary"
        title="Sign out"
        onPress={async () => {
          await signOut();
          router.replace("/welcome");
        }}
      />
      <Celebration
        moment={moment}
        onDone={() => {
          setMoment(null);
          router.replace("/tree");
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.text },
  notice: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.teal },
  request: { gap: 2, borderTopWidth: 1, borderTopColor: colors.lanternBorder, paddingTop: 8 },
  result: { gap: 4, borderTopWidth: 1, borderTopColor: colors.lanternBorder, paddingTop: 10 },
  name: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.text },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smallBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.gold },
  smallBtnText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.gold },
});
