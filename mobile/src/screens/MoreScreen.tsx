import React from "react";
import { View, Text, StyleSheet } from "react-native";

/** Drawer entry — mirrors web "More" tab (full sidebar navigation). */
export function MoreScreen() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>More</Text>
      <Text style={styles.sub}>Reports, Website Studio, Settings, Wholesale, and all shop tools.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", color: "#1a2b48" },
  sub: { marginTop: 8, color: "#5a4a52" },
});
