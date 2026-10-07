import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import utmeImage from '../assets/images/regenerated_image_1783920931116.jpg';
import postUtmeImage from '../assets/images/regenerated_image_1783921765545.jpg';
import undergradImage from '../assets/images/regenerated_image_1783921766425.jpg';

const portals = [
  {
    id: 'utme',
    title: 'UTME Mastery',
    description: <>Intensive preparatory materials, past questions, and expert tips to secure your <span className="font-space font-bold text-[1.1em]">300+</span> score.</>,
    image: utmeImage,
  },
  {
    id: 'post-utme',
    title: 'Unilorin Post UTME',
    description: 'Specific institution mock exams and tailored modules for top-tier Nigerian universities.',
    image: postUtmeImage,
  },
  {
    id: 'undergraduate',
    title: 'Undergraduate',
    description: 'Advanced course materials, GPA boosters, and career guidance for university students.',
    image: undergradImage,
  }
];

export default function Portals() {
  return (
    <section className="bg-[#020617] grid-border border-x-0 border-t-0 border-b-0 relative" id="portals">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 grid-border border-y-0 border-x-0">
        
        <div className="py-16 md:py-24 text-center max-w-3xl mx-auto grid-border border-x-0 border-t-0 border-b">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-3xl md:text-5xl tracking-tighter text-white mb-6 underline font-display font-extrabold"
          >
            Academic Portals
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ delay: 0.1 }}
            className="text-lg text-slate-400 font-body font-normal"
          >
            Choose the right pathway for your academic level.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3">
          {portals.map((portal, index) => (
            <motion.div
              key={portal.id}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              whileHover={{ 
                y: -10, 
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                boxShadow: "0 25px 50px -12px rgba(245, 158, 11, 0.15)"
              }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
              className={`p-8 md:p-12 flex flex-col space-y-4 transition-all duration-300 group ${index < 2 ? 'md:grid-border md:border-y-0 md:border-l-0 border-b md:border-b-0 border-white/10' : ''}`}
            >
              {portal.image ? (
                <div className="w-full h-32 md:h-48 rounded-lg overflow-hidden mb-2 relative">
                  <motion.img 
                    whileHover={{ scale: 1.1 }}
                    transition={{ duration: 0.4 }}
                    src={portal.image} 
                    alt={portal.title} 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ) : (
                <div className="w-full h-32 md:h-48 image-placeholder rounded-lg flex items-center justify-center text-[10px] font-poppins font-medium text-slate-500 mb-2">
                  {portal.title} Image
                </div>
              )}
              
              <h3 className="text-2xl font-display font-bold accent-text tracking-tight">{portal.title}</h3>
              <p className="text-sm md:text-base text-slate-400 flex-1 leading-relaxed font-body font-normal">
                {portal.description}
              </p>
              {/*
                "Learn More" is hidden on the UTME and Undergraduate cards by
                request. It is a decorative button with no onClick — it navigates
                nowhere and opens nothing — so hiding it removes a dead control
                rather than a working one.

                Post-UTME is deliberately left untouched: only UTME and
                Undergraduate were named, and removing it there too is a
                one-line change if that is wanted.
              */}
              {portal.id !== 'utme' && portal.id !== 'undergraduate' && (
                <motion.button
                  whileHover={{ scale: 1.05, textShadow: "0 0 8px rgba(96, 165, 250, 0.5)" }}
                  whileTap={{ scale: 0.95 }}
                  className="text-xs font-action font-semibold text-blue-400 uppercase tracking-widest text-left mt-4 flex items-center gap-2 w-fit relative after:content-[''] after:absolute after:-bottom-1 after:left-0 after:w-full after:h-[1px] after:bg-blue-400 after:scale-x-0 after:origin-right hover:after:scale-x-100 hover:after:origin-left after:transition-transform"
                >
                  Learn More <ArrowRight className="w-4 h-4" />
                </motion.button>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
