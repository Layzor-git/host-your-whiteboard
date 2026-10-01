// Avatars with initials in the person's peer color (design V2, 7a-7j).
// Someone who has never signed in gets a neutral circle with the first
// letter of the address.

export function initialen(p) {
  if (p?.name) {
    return p.name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }
  return (p?.email?.[0] ?? '?').toUpperCase();
}

/** First name or first part of the name, otherwise the address. */
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

/** Overlapping avatars, at most max, then "+n". */
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
