#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum Street {
    #[default]
    Pref = 0isize,
    Flop = 1isize,
    Turn = 2isize,
    Rive = 3isize,
}

impl Street {
    pub const fn all() -> [Self; 4] {
        [Self::Pref, Self::Flop, Self::Turn, Self::Rive]
    }

    pub const fn symbol(&self) -> &'static str {
        match self {
            Self::Pref => "P",
            Self::Flop => "F",
            Self::Turn => "T",
            Self::Rive => "R",
        }
    }

    pub const fn label(&self) -> &'static str {
        match self {
            Self::Pref => "Preflop",
            Self::Flop => "Flop",
            Self::Turn => "Turn",
            Self::Rive => "River",
        }
    }

    pub const fn next(&self) -> Self {
        match self {
            Self::Pref => Self::Flop,
            Self::Flop => Self::Turn,
            Self::Turn => Self::Rive,
            Self::Rive => panic!("terminal"),
        }
    }

    pub const fn prev(&self) -> Self {
        match self {
            Self::Pref => panic!("starting"),
            Self::Flop => Self::Pref,
            Self::Turn => Self::Flop,
            Self::Rive => Self::Turn,
        }
    }


    pub const fn n_observed(&self) -> usize {
        match self {
            Self::Pref => 2,
            Self::Flop => 5,
            Self::Turn => 6,
            Self::Rive => 7,
        }
    }

    pub const fn n_revealed(&self) -> usize {
        match self {
            Self::Pref => 2,
            Self::Flop => 3,
            Self::Turn => 1,
            Self::Rive => 1,
        }
    }

}

#[cfg(not(feature = "shortdeck"))]
impl Street {
    pub const fn n_children(&self) -> usize {
        match self {
            Self::Pref => 19_600,
            Self::Flop => 0___47,
            Self::Turn => 0___46,
            Self::Rive => panic!("terminal"),
        }
    }

    pub const fn n_isomorphisms(&self) -> usize {
        match self {
            Self::Pref => 0_________169,
            Self::Flop => 0___1_286_792,
            Self::Turn => 0__13_960_050,
            Self::Rive => 0_123_156_254,
        }
    }

    pub const fn n_observations(&self) -> usize {
        match self {
            Self::Pref => 0_______1_326,
            Self::Flop => 0__25_989_600,
            Self::Turn => 0_305_377_800,
            Self::Rive => 2_809_475_760,
        }
    }
}

#[cfg(feature = "shortdeck")]
impl Street {
    pub const fn n_children(&self) -> usize {
        match self {
            Self::Pref => 5_984,
            Self::Flop => 0__31,
            Self::Turn => 0__30,
            Self::Rive => panic!("terminal"),
        }
    }

    pub const fn n_isomorphisms(&self) -> usize {
        match self {
            Self::Pref => 0__________81,
            Self::Flop => 0_____186_696,
            Self::Turn => 0___1_340_856,
            Self::Rive => 0___7_723_728,
        }
    }

    pub const fn n_observations(&self) -> usize {
        match self {
            Self::Pref => 0_________630,
            Self::Flop => 0___3_769_920,
            Self::Turn => 0__29_216_880,
            Self::Rive => 0_175_301_280,
        }
    }
}

impl From<isize> for Street {
    fn from(n: isize) -> Self {
        match n {
            0 => Self::Pref,
            1 => Self::Flop,
            2 => Self::Turn,
            3 => Self::Rive,
            x => panic!("no other u8s {}", x),
        }
    }
}

impl From<usize> for Street {
    fn from(n: usize) -> Self {
        match n {
            2 => Self::Pref,
            5 => Self::Flop,
            6 => Self::Turn,
            7 => Self::Rive,
            x => panic!("no other usizes {}", x),
        }
    }
}

/// useful for reference of Postgres Street::from(i64) calculation that is done in analysis.sql
impl From<i64> for Street {
    fn from(obs: i64) -> Self {
        Self::from(
            (0u64..8u64)
                .map(|i| obs >> (i * 8))
                .take_while(|bits| *bits > 0)
                .map(|bits| bits as u8)
                .map(|bits| bits - 1)
                .map(|bits| 1u64 << bits)
                .count(),
        )
    }
}

impl core::fmt::Display for Street {
    fn fmt(&self, f: &mut core::fmt::Formatter) -> core::fmt::Result {
        match self {
            Self::Pref => write!(f, "preflop"),
            Self::Flop => write!(f, "flop"),
            Self::Turn => write!(f, "turn"),
            Self::Rive => write!(f, "river"),
        }
    }
}

impl TryFrom<&str> for Street {
    type Error = &'static str;
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s.to_uppercase().chars().next() {
            Some('P') => Ok(Self::Pref),
            Some('F') => Ok(Self::Flop),
            Some('T') => Ok(Self::Turn),
            Some('R') => Ok(Self::Rive),
            _ => Err("invalid street character"),
        }
    }
}
