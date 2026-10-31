// Chequered flag background (FINISH) for full-screen views.

export function checkeredSx(size = 64) {
  return {
    backgroundColor: "#fff",
    backgroundImage: "repeating-conic-gradient(#000 0% 25%, #fff 0% 50%)",
    backgroundSize: `${size}px ${size}px`,
  } as const;
}
