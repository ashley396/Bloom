import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";

const LOGO = "https://www.florisyn.com/assets/florisyn/florisyn-official-icon.png?v=official1";

export function DashboardScreen() {
  return (
    <View style={styles.wrap}>
      <Image source={{ uri: LOGO }} style={styles.logo} accessibilityLabel="Florisyn" />
      <Text style={styles.title}>Florisyn POS</Text>
      <Text style={styles.sub}>Connect this app to your shop API token to sync orders.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#f7f4ef" },
  logo: { width: 72, height: 72, borderRadius: 16, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: "700", color: "#1a2b48" },
  sub: { marginTop: 8, textAlign: "center", color: "#5a4a52" },
});
