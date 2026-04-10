"""
Generate synthetic ticket data for training the OpsMind AI models.

Usage
-----
    python -m src.generate_sample_data --output sample_tickets.csv --rows 2000
"""

import argparse
import random
from datetime import datetime, timedelta

import pandas as pd


def generate(rows: int = 2000, seed: int = 42) -> pd.DataFrame:
    random.seed(seed)

    priorities = ["Low", "Medium", "High", "Critical"]
    support_levels = ["L1", "L2", "L3"]
    buildings = ["Main", "Annex", "Tower A", "Tower B", "Data Center"]
    rooms = [str(r) for r in range(100, 510, 1)]
    request_types = [
        "Network Issue",
        "Hardware Failure",
        "Software Bug",
        "Access Request",
        "Password Reset",
        "Email Issue",
        "Printer Issue",
        "VPN Issue",
        "Account Lockout",
        "Other",
    ]
    statuses = ["Open", "In Progress", "Resolved", "Closed"]

    title_templates = {
        "Network Issue": ["Network down in {building}", "Slow internet in room {room}", "Cannot connect to Wi-Fi"],
        "Hardware Failure": ["Laptop not booting", "Monitor flickering in {room}", "Keyboard broken"],
        "Software Bug": ["App crashes on startup", "Error 500 on portal", "Dashboard not loading"],
        "Access Request": ["Need access to shared drive", "VPN access request", "New user setup"],
        "Password Reset": ["Forgot password", "Password expired", "Cannot reset password"],
        "Email Issue": ["Cannot send emails", "Email sync failing", "Missing emails"],
        "Printer Issue": ["Printer offline in {room}", "Print jobs stuck", "Toner replacement needed"],
        "VPN Issue": ["VPN not connecting", "VPN slow performance", "VPN certificate expired"],
        "Account Lockout": ["Account locked out", "Cannot login to workstation", "AD account disabled"],
        "Other": ["General IT request", "Need help with setup", "Miscellaneous issue"],
    }

    records = []
    base_date = datetime(2025, 1, 1)

    for i in range(rows):
        req_type = random.choice(request_types)
        priority = random.choices(priorities, weights=[35, 35, 20, 10])[0]
        building = random.choice(buildings)
        room = random.choice(rooms)
        support = random.choice(support_levels)
        status = random.choice(statuses)
        created = base_date + timedelta(
            days=random.randint(0, 400),
            hours=random.randint(0, 23),
            minutes=random.randint(0, 59),
        )

        # Resolution time correlates with priority
        base_hours = {"Low": 48, "Medium": 24, "High": 8, "Critical": 2}
        res_hours = max(0.5, base_hours[priority] + random.gauss(0, base_hours[priority] * 0.4))
        closed = created + timedelta(hours=res_hours)

        title = random.choice(title_templates[req_type]).format(building=building, room=room)
        description = f"User reported: {title}. Needs attention in {building} room {room}."

        records.append(
            {
                "id": i + 1,
                "title": title,
                "description": description,
                "requester_id": random.randint(1000, 9999),
                "assigned_to": random.randint(1, 50),
                "assigned_to_level": support,
                "priority": priority,
                "support_level": support,
                "status": status,
                "escalation_count": random.randint(0, 3),
                "resolution_summary": f"Resolved by {support} team.",
                "building": building,
                "room": room,
                "is_deleted": False,
                "created_at": created.isoformat(),
                "updated_at": (created + timedelta(hours=res_hours * 0.5)).isoformat(),
                "closed_at": closed.isoformat(),
                "type_of_request": req_type,
            }
        )

    return pd.DataFrame(records)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate sample ticket data")
    parser.add_argument("--output", type=str, default="sample_tickets.csv")
    parser.add_argument("--rows", type=int, default=2000)
    args = parser.parse_args()

    df = generate(rows=args.rows)
    df.to_csv(args.output, index=False)
    print(f"✅ Generated {len(df)} rows → {args.output}")


if __name__ == "__main__":
    main()
