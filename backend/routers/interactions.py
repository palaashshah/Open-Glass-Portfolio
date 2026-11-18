from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import uuid
from datetime import datetime, timezone
from typing import Optional

from audit_trail import record_audit
from database import get_db
from models import Interaction, Investor
from schemas import InteractionCreate, InteractionResponse

router = APIRouter(
    prefix="/interactions",
    tags=["Interactions"]
)

@router.post("/", response_model=InteractionResponse)
#                   ↑
#                   InteractionCreate is what comes IN. InteractionResponse is what goes OUT.
def create_interactions(interaction: InteractionCreate, db: Session = Depends(get_db)):
    investor = db.query(Investor).filter(Investor.id == interaction.investor_id).first()
    if not investor:
        raise HTTPException(status_code=404, detail="Investor not found")

    new_interaction = Interaction(
        id=str(uuid.uuid4()),
        **interaction.model_dump()
    )
    if not new_interaction.timestamp:
        new_interaction.timestamp = datetime.now(timezone.utc)
    db.add(new_interaction)

    # Logging an interaction changes data, so it leaves an audit row like every
    # other change. Saved in the same commit as the interaction itself.
    record_audit(db, interaction.manager_id, "interaction.logged", "interaction", new_interaction.id,
                 after={"investor_id": investor.id,
                        "interaction_type": new_interaction.interaction_type,
                        "notes": new_interaction.notes})
    db.commit()
    db.refresh(new_interaction)
    return new_interaction

@router.get("/", response_model=list[InteractionResponse])
def get_interactions(investor_id: Optional[str] = None, db: Session = Depends(get_db)):
    # Optional[str] = None means investor_id is no longer required
    # if investor_id is provided → filter by it
    # if not provided → return everything

    query = db.query(Interaction)
    if investor_id:
        # filter by investor
        query = query.filter(Interaction.investor_id == investor_id)
        # db query => Interaction, where Interaction.investor_id == {investor_id}
    # no filter — return all interactions

    # No interactions is a normal answer, not an error: return an empty list.
    return query.order_by(Interaction.timestamp).all()