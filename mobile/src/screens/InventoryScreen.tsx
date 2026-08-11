import React from "react";
import { View, Text, StyleSheet } from "react-native";

export function InventoryScreen() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Inventory</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", color: "#1a2b48" },
});
