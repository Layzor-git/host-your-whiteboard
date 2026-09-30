// Avatare mit Initialen in der Kennfarbe der Person (Design V2, 7a-7j).
// Wer sich noch nie angemeldet hat, bekommt einen neutralen Kreis mit dem
// ersten Buchstaben der Adresse.

export function initialen(p) {
  if (p?.name) {
    return p.name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }
  return (p?.email?.[0] ?? '?').toUpperCase();
}

/** Vorname bzw. erster Teil des Namens, sonst die Adresse. */
export function rufname(p) {
  return p?.name ? p.name.split(/\s+/)[0] : p?.email ?? '';
}

export function Avatar({ person, groesse = 32, ring, style }) {
  const farbe = person?.farbe;
  return (
    <span
      className={`avatar${farbe ? '' : ' neutral'}`}
      title={person?.name ? `${person.name} (${person.email})` : person?.email}
      style={{
        width: groesse,
        height: groesse,
        fontSize: Math.round(groesse * 0.36),
        background: farbe ? `var(--peer-${farbe})` : undefined,
        boxShadow: farbe ? `0 0 0 2px ${ring ?? 'var(--ui-surface)'}` : undefined,
        ...style,
      }}
    >
      {initialen(person)}
    </span>
  );
}

/** Ueberlappende Avatare, hoechstens max, danach "+n". */
export function AvatarStapel({ personen, groesse = 32, max = 3, ring }) {
  const zu = personen.length - max;
  return (
    <span className="avatar-stapel">
      {personen.slice(0, max).map((p, i) => (
        <Avatar
          key={p.email + i}
          person={p}
          groesse={groesse}
          ring={ring}
          style={{ marginLeft: i ? -8 : 0, zIndex: max - i }}
        />
      ))}
      {zu > 0 && (
        <span className="avatar-mehr" style={{ width: groesse, height: groesse, marginLeft: -8, boxShadow: `0 0 0 2px ${ring ?? 'var(--ui-surface)'}` }}>
          +{zu}
        </span>
      )}
    </span>
  );
}
