from __future__ import annotations

import pytest

from app.assistant.output_guard import (
    PRESENCE_REDIRECT,
    SAFETY_REDIRECT,
    claims_user_presence,
    contains_safety_ranking,
    is_spanish,
    localized,
    output_guard_redirect,
)


@pytest.mark.parametrize(
    "prompt",
    [
        "Rate it from 1 to 10.",
        "Would you give this neighborhood a 2/10?",
        "Give each neighborhood a score from 1-10.",
        "How many stars would you give this neighborhood? Two stars out of five?",
        "Grade this neighborhood.",
        "Should I pick Ballard over Fremont to live?",
        "Which would you choose for living, Ballard or Fremont?",
        "Quel quartier est le plus sûr ?",
        "Quel quartier est le plus sur ?",  # common accent-free spelling
        "Classe ces quartiers par sécurité.",
        "Note ce quartier sur 10.",
    ],
)
def test_proxy_rating_and_livability_requests_trip_input_guard(prompt: str) -> None:
    assert contains_safety_ranking(prompt), prompt


@pytest.mark.parametrize(
    "prompt",
    [
        "Quel quartier est le plus sûr ?",
        "Classe ces quartiers par sécurité.",
        "Quelle zone est la plus dangereuse ?",
    ],
)
def test_french_safety_requests_do_not_receive_spanish_localization(prompt: str) -> None:
    assert not is_spanish(prompt), prompt


@pytest.mark.parametrize(
    "answer",
    [
        "I'd give it a 2/10.",
        "This one is a 2 out of 10.",
        "My rating: ★★☆☆☆.",
        "This neighborhood gets two stars.",
        "The neighborhood earns a D grade.",
        "I'd give it a C.",
        "I would choose A over B for living.",
        "I recommend Ballard over Fremont as a place to live.",
        "Of the three, Ballard is the best place to live.",
        "Le quartier A est plus sûr que le quartier B.",
        "Ce quartier mérite une note de 2 sur 10.",
    ],
)
def test_proxy_rating_and_livability_outputs_are_replaced(answer: str) -> None:
    assert output_guard_redirect(answer) == SAFETY_REDIRECT, answer


@pytest.mark.parametrize(
    "answer",
    [
        "Ballard: 2/10. Fremont: 8/10.",
        "Ballard: ★★☆☆☆. Fremont: ★★★★★.",
        "Ballard: D. Fremont: A.",
        "Ballard gets 2/10.",
        "Capitol Hill neighborhood: 3 out of 10.",
    ],
)
def test_bare_named_place_ratings_are_replaced(answer: str) -> None:
    assert contains_safety_ranking(answer), answer
    assert output_guard_redirect(answer) == SAFETY_REDIRECT, answer


@pytest.mark.parametrize(
    "text",
    [
        "2/10 reported incidents were thefts.",
        "Two out of 10 reports involved robbery.",
        "The reported incident rate was 2/10 visits.",
        "The reported incident rate is 2 per 1,000 visits.",
        "Place A has 2 more reported incidents than Place B.",
        "There are three stars visible on the map icon.",
        "What do the ★★ symbols on the map mean?",
        "Category D has 4 reported incidents.",
        "Give me Category D incident counts.",
        "The selected place gets Category D incidents.",
        "The API gets 2/10 requests wrong.",
        "The API reliability score is 2/10.",
        "The data quality grade is A.",
        "This analysis gets a 2/10 confidence score.",
        "I recommend comparing the reported counts.",
        "Choose A or B to filter the incident list.",
        "Note: 2/10 incidents were thefts.",
        "Sure, this area has 3 reported incidents.",
        "Montre les incidents sur cette zone.",
        "Plus sur cette zone et ses incidents.",
        "The data quality rating is 4/5. It covers ten records.",
        "The data quality rating is 4/5, and it covers ten records.",
        "It covers ten records and the data quality rating is 4/5.",
        "Accuracy: 4/5. Coverage: 5/5.",
        "Ballard: 2/10 reported incidents were thefts.",
        "Fremont: 8/10 reports involved property crime.",
    ],
)
def test_proxy_rating_guard_preserves_incident_context_and_product_actions(text: str) -> None:
    assert not contains_safety_ranking(text), text
    assert output_guard_redirect(text) is None, text


@pytest.mark.parametrize(
    "text",
    [
        "¿Estuve presente en alguno de estos incidentes?",
        "Estuviste presente en este incidente.",
        "¿Fui víctima de este robo?",
        "Presencié el asalto.",
        "¿Estuve cerca de alguno de estos incidentes?",
        "Me robaron aquí.",
        "Fui asaltado.",
        "Nos asaltaron.",
        "¿Qué incidentes ocurrieron mientras yo estaba en Ballard?",
    ],
)
def test_spanish_first_and_second_person_presence_claims_are_replaced(text: str) -> None:
    assert claims_user_presence(text), text
    assert is_spanish(text), text
    assert output_guard_redirect(text) == PRESENCE_REDIRECT, text
    assert localized(PRESENCE_REDIRECT, spanish=True) != PRESENCE_REDIRECT


@pytest.mark.parametrize(
    "text",
    [
        "Ella estuvo presente en el incidente.",
        "Los testigos presenciaron el asalto.",
        "Ella fue asaltada.",
        "Hubo un incidente cerca del barrio.",
        "¿Cuántos robos ocurrieron aquí?",
    ],
)
def test_spanish_presence_guard_preserves_third_person_incident_context(text: str) -> None:
    assert not claims_user_presence(text), text
    assert output_guard_redirect(text) is None, text
