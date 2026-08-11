import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
} from "react-native";
import { createFlorisynServices } from "../services/florisynServices";

type Props = {
  baseUrl?: string;
  getToken?: () => string | null;
};

export function WebsiteScreen({ baseUrl = "https://www.florisyn.com", getToken = () => null }: Props) {
  const services = createFlorisynServices({ baseUrl, getToken });
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<{ status?: string; seo_settings?: { title?: string } } | null>(null);
  const [checklist, setChecklist] = useState<{ kpis?: { readiness_score?: number; seo_score?: number }; ready?: boolean } | null>(null);
  const [domain, setDomain] = useState("");
  const [domainStatus, setDomainStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await services.website.getProject()) as { project?: typeof project; pages?: unknown[] };
      setProject(data.project ?? null);
      const cl = (await services.website.publishChecklist({ project: data.project, pages: data.pages })) as typeof checklist;
      setChecklist(cl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load website.");
    } finally {
      setLoading(false);
    }
  }, [services]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function verifyDomain() {
    setDomainStatus("Checking DNS…");
    try {
      const d = (await services.website.verifyDomain(domain)) as { verified?: boolean; verification?: { error?: string } };
      setDomainStatus(d.verified ? "Domain verified" : d.verification?.error || "Not verified yet");
    } catch (e) {
      setDomainStatus(e instanceof Error ? e.message : "Verification failed");
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#8f3f68" />
        <Text style={styles.sub}>Loading Website Studio…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>WEBSITE STUDIO</Text>
      <Text style={styles.title}>Your florist website</Text>
      <Text style={styles.sub}>Manage publish status, SEO scores, and custom domains from mobile.</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Status</Text>
        <Text style={styles.cardValue}>{project?.status === "published" ? "Published" : "Draft"}</Text>
        {project?.seo_settings?.title ? (
          <Text style={styles.meta}>SEO: {project.seo_settings.title}</Text>
        ) : null}
      </View>

      {checklist?.kpis ? (
        <View style={styles.row}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Readiness</Text>
            <Text style={styles.kpiValue}>{checklist.kpis.readiness_score ?? 0}%</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>SEO</Text>
            <Text style={styles.kpiValue}>{checklist.kpis.seo_score ?? 0}%</Text>
          </View>
        </View>
      ) : null}

      <Text style={styles.section}>Custom domain</Text>
      <TextInput
        style={styles.input}
        placeholder="www.yourflowershop.com"
        value={domain}
        onChangeText={setDomain}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable style={styles.btnSecondary} onPress={verifyDomain}>
        <Text style={styles.btnSecondaryText}>Verify DNS</Text>
      </Pressable>
      {domainStatus ? <Text style={styles.meta}>{domainStatus}</Text> : null}

      <Pressable style={styles.btn} onPress={() => Linking.openURL(`${baseUrl}/#websitePage`)}>
        <Text style={styles.btnText}>Open full Website Studio on web</Text>
      </Pressable>
      <Pressable style={styles.btnSecondary} onPress={refresh}>
        <Text style={styles.btnSecondaryText}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#faf7f2" },
  content: { padding: 24, paddingBottom: 48 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  eyebrow: { fontSize: 11, letterSpacing: 1, color: "#8f3f68", fontWeight: "600" },
  title: { fontSize: 24, fontWeight: "700", color: "#1a2b48", marginTop: 4 },
  sub: { marginTop: 8, color: "#5a4a52", lineHeight: 20 },
  error: { marginTop: 12, color: "#a33" },
  card: { marginTop: 20, padding: 16, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e8e0e4" },
  cardLabel: { fontSize: 12, color: "#5a4a52" },
  cardValue: { fontSize: 20, fontWeight: "700", color: "#1a2b48", marginTop: 4 },
  meta: { marginTop: 8, fontSize: 13, color: "#5a4a52" },
  row: { flexDirection: "row", gap: 12, marginTop: 16 },
  kpi: { flex: 1, padding: 12, backgroundColor: "#fff", borderRadius: 10, alignItems: "center" },
  kpiLabel: { fontSize: 12, color: "#5a4a52" },
  kpiValue: { fontSize: 22, fontWeight: "700", color: "#8f3f68" },
  section: { marginTop: 24, fontSize: 16, fontWeight: "600", color: "#1a2b48" },
  input: {
    marginTop: 8,
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e8e0e4",
    fontSize: 16,
    minHeight: 48,
  },
  btn: { marginTop: 20, backgroundColor: "#8f3f68", padding: 14, borderRadius: 10, alignItems: "center", minHeight: 48, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  btnSecondary: { marginTop: 12, padding: 14, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: "#c9899e", minHeight: 48, justifyContent: "center" },
  btnSecondaryText: { color: "#8f3f68", fontWeight: "600" },
});
