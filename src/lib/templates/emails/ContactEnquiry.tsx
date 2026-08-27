import React from 'react';

type ContactEnquiryEmailProps = {
  name: string;
  email: string;
  eventDate: string;
  venue: string;
  enquiry: string;
};

export function ContactEnquiryEmail({
  name,
  email,
  eventDate,
  venue,
  enquiry,
}: ContactEnquiryEmailProps) {
  // #8B7355
  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', color: '#000000' }}>
      <h2 style={{ textDecoration: 'underline', marginBottom: '20px' }}>
        Customer query
      </h2>

      <p>
        <strong>Name:</strong> {name}
      </p>
      <p>
        <strong>Email:</strong> {email}
      </p>
      <p>
        <strong>Event date:</strong> {eventDate}
      </p>

      <p>
        <strong>Venue:</strong>
      </p>
      <p>{venue}</p>

      <p>
        <strong>Enquiry details:</strong>
      </p>
      <p>{enquiry}</p>
    </div>
  );
}
